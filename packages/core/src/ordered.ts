import { generateKeyBetween, generateNKeysBetween } from 'fractional-indexing';
import { current, isDraft } from 'immer';

/**
 * Normalised ordered collection: items by id, ordered by a fractional-index `key` stored on each item.
 * Moving or inserting an item changes ONE item (not every following array slot), so Immer emits a handful of
 * patches instead of hundreds. This is the fix for the S5 finding (docs/research/spike-results.md).
 */
export interface OrderedItem {
  readonly id: string;
  key: string;
}

export interface Ordered<T extends OrderedItem> {
  byId: Record<string, T>;
}

export function createOrdered<T extends OrderedItem>(): Ordered<T> {
  return { byId: {} };
}

/**
 * Read-only view of a collection. Inside an Immer recipe the collection is a draft; reading every item through
 * the draft would create a proxy per item (slow), so we read a plain snapshot of the current state instead.
 */
function readable<T extends OrderedItem>(collection: Ordered<T>): Ordered<T> {
  // `current` only accepts drafts; at runtime this branch is taken exactly when `collection` is one.
  if (!isDraft(collection)) return collection;
  const snapshot: unknown = current(collection as never);
  return snapshot as Ordered<T>;
}

/** Items in display order. Ties (should not happen) are broken by id so the order is always deterministic. */
export function sortedItems<T extends OrderedItem>(collection: Ordered<T>): T[] {
  return Object.values(readable(collection).byId).sort((a, b) =>
    a.key < b.key ? -1 : a.key > b.key ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
}

export function orderedSize<T extends OrderedItem>(collection: Ordered<T>): number {
  return Object.keys(readable(collection).byId).length;
}

function clampIndex(index: number, length: number): number {
  return Math.min(Math.max(Math.trunc(index), 0), length);
}

/** Insert one item so that it ends up at `index` (0 = first, length = last). */
export function insertAt<T extends OrderedItem>(
  collection: Ordered<T>,
  item: Omit<T, 'key'>,
  index: number,
): void {
  if (item.id in collection.byId) throw new RangeError(`Item ${item.id} already exists`);
  const items = sortedItems(collection);
  const at = clampIndex(index, items.length);
  const key = generateKeyBetween(items[at - 1]?.key ?? null, items[at]?.key ?? null);
  collection.byId[item.id] = { ...item, key } as T;
}

/** Append many items at the end with one call; keys are generated together. */
export function appendItems<T extends OrderedItem>(
  collection: Ordered<T>,
  newItems: readonly Omit<T, 'key'>[],
): void {
  if (newItems.length === 0) return;
  for (const item of newItems) {
    if (item.id in collection.byId) throw new RangeError(`Item ${item.id} already exists`);
  }
  const items = sortedItems(collection);
  const keys = generateNKeysBetween(items.at(-1)?.key ?? null, null, newItems.length);
  newItems.forEach((item, i) => {
    collection.byId[item.id] = { ...item, key: keys[i] as string } as T;
  });
}

/** Move an item so that it ends up at `index` in the list that results from the move. */
export function moveTo<T extends OrderedItem>(
  collection: Ordered<T>,
  id: string,
  index: number,
): void {
  const item = collection.byId[id];
  if (!item) throw new RangeError(`Item ${id} does not exist`);
  const others = sortedItems(collection).filter((other) => other.id !== id);
  const at = clampIndex(index, others.length);
  item.key = generateKeyBetween(others[at - 1]?.key ?? null, others[at]?.key ?? null);
}

export function removeItem<T extends OrderedItem>(collection: Ordered<T>, id: string): void {
  if (!(id in collection.byId)) throw new RangeError(`Item ${id} does not exist`);

  delete collection.byId[id];
}
