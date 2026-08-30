import { config, assertMondayConfig } from "./config";

export type MondayRow = {
  itemId: string;
  itemName: string;
  /** column title -> display text */
  values: Record<string, string>;
};

export type BoardFetchResult = {
  boardId: string;
  boardName: string;
  columnTitles: string[];
  rows: MondayRow[];
  fetchedAt: string;
};

export class MondayError extends Error {}

const ITEMS_QUERY = `
query BoardItems($boardId: [ID!], $limit: Int!) {
  boards(ids: $boardId) {
    id
    name
    columns { id title type }
    items_page(limit: $limit) {
      cursor
      items {
        id
        name
        column_values { id text column { title } }
      }
    }
  }
}`;

const NEXT_PAGE_QUERY = `
query NextItemsPage($cursor: String!, $limit: Int!) {
  next_items_page(cursor: $cursor, limit: $limit) {
    cursor
    items {
      id
      name
      column_values { id text column { title } }
    }
  }
}`;

type MondayItem = {
  id: string;
  name: string;
  column_values: { id: string; text: string | null; column: { title: string } | null }[];
};

async function gql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  let res: Response;
  try {
    res = await fetch(config.monday.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: config.monday.token,
        "API-Version": config.monday.apiVersion,
      },
      body: JSON.stringify({ query, variables }),
      cache: "no-store",
    });
  } catch {
    throw new MondayError("Could not reach monday.com. Please check network connectivity and retry.");
  }

  if (res.status === 401 || res.status === 403) {
    throw new MondayError("monday.com rejected the API token. Check MONDAY_API_TOKEN and its board permissions.");
  }
  if (res.status === 429) {
    throw new MondayError("monday.com rate limit reached. Please retry in a moment.");
  }
  if (!res.ok) {
    throw new MondayError(`monday.com returned an unexpected response (HTTP ${res.status}).`);
  }

  const body = (await res.json()) as { data?: T; errors?: { message: string }[] };
  if (body.errors?.length) {
    // Surface the message only — never the token or full payload.
    throw new MondayError(`monday.com query failed: ${body.errors[0].message}`);
  }
  if (!body.data) throw new MondayError("monday.com returned an empty response.");
  return body.data;
}

/** Map an item to a plain object keyed by COLUMN TITLE (never generated column IDs). */
function toRow(item: MondayItem): MondayRow {
  const values: Record<string, string> = {};
  for (const cv of item.column_values || []) {
    const title = cv.column?.title?.trim();
    if (!title) continue;
    values[title] = (cv.text ?? "").trim();
  }
  return { itemId: item.id, itemName: item.name ?? "", values };
}

/** Fetch every item on a board, following items_page/next_items_page cursors. */
export async function fetchBoard(boardId: string, pageLimit = 250): Promise<BoardFetchResult> {
  assertMondayConfig();

  const first = await gql<{
    boards: {
      id: string;
      name: string;
      columns: { id: string; title: string; type: string }[];
      items_page: { cursor: string | null; items: MondayItem[] };
    }[];
  }>(ITEMS_QUERY, { boardId: [boardId], limit: pageLimit });

  const board = first.boards?.[0];
  if (!board) {
    throw new MondayError(`Board ${boardId} was not found or the token cannot access it.`);
  }

  const rows: MondayRow[] = board.items_page.items.map(toRow);
  let cursor = board.items_page.cursor;
  let guard = 0;

  while (cursor && guard < 100) {
    guard += 1;
    const page = await gql<{ next_items_page: { cursor: string | null; items: MondayItem[] } }>(
      NEXT_PAGE_QUERY,
      { cursor, limit: pageLimit },
    );
    rows.push(...page.next_items_page.items.map(toRow));
    cursor = page.next_items_page.cursor;
  }

  return {
    boardId: board.id,
    boardName: board.name,
    columnTitles: board.columns.map((c) => c.title),
    rows,
    fetchedAt: new Date().toISOString(),
  };
}

/** One retry on transient failures, then give up to the caller. */
export async function fetchBoardWithRetry(boardId: string): Promise<BoardFetchResult> {
  try {
    return await fetchBoard(boardId);
  } catch (err) {
    if (err instanceof MondayError && /rate limit|could not reach|unexpected response/i.test(err.message)) {
      await new Promise((r) => setTimeout(r, 900));
      return fetchBoard(boardId);
    }
    throw err;
  }
}
