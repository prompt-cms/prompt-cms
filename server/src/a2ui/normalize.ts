/**
 * Tolerant repair of common LLM mistakes before spec-exact SDK validation.
 *
 * Smaller models (e.g. gemma) intermittently produce semantically-correct
 * operations that violate the A2UI envelope/structure rules. The repairs here
 * are mechanical and semantics-preserving; anything not unambiguously
 * repairable passes through untouched so the SDK validator remains the
 * source of truth. The *content* (text, urls, data model values) is never
 * modified — only structure.
 *
 * Repairs (each observed in real model output):
 * 1. missing `version` on a message            → inject `'v0.9'`
 * 2. bare `{surfaceId, components}` payload    → wrap in `updateComponents`
 *    (and the `updateDataModel` analog)
 * 3. `updateComponents`/`updateDataModel` missing `surfaceId`
 *                                              → infer from the last
 *                                                `createSurface` in the list
 * 4. one message carrying TWO payload keys     → split into one message each
 *    (e.g. `updateComponents` + `updateDataModel` merged)
 * 5. inline component objects inside `children`/`child`
 *                                              → flatten into the flat list,
 *    children become ID references (the spec forbids inline children);
 *    components without `id` get generated ones
 * 6. numeric fields sent as strings (`weight: "1"`) → coerced to numbers
 * 7. a single component object sent AS the `updateComponents` payload
 *    (`{component, id, ...}`)                  → wrapped in a components list
 */

/** Message payload keys defined by the A2UI v0.9 protocol. */
const PAYLOAD_KEYS = [
  'createSurface',
  'updateComponents',
  'updateDataModel',
  'deleteSurface',
] as const;

type PayloadKey = (typeof PAYLOAD_KEYS)[number];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Unique-id generator that avoids collisions with ids already in the tree. */
class IdGenerator {
  private readonly used: Set<string>;
  private counter = 0;

  constructor(existingIds: Iterable<string>) {
    this.used = new Set(existingIds);
  }

  next(hint: string): string {
    let id = hint;
    while (this.used.has(id)) {
      this.counter += 1;
      id = `${hint}_${this.counter}`;
    }
    this.used.add(id);
    return id;
  }
}

function collectIds(components: unknown[], into: Set<string>): void {
  for (const comp of components) {
    if (!isRecord(comp)) continue;
    if (typeof comp.id === 'string') into.add(comp.id);
    if (Array.isArray(comp.children)) collectIds(comp.children, into);
    if (isRecord(comp.child)) collectIds([comp.child], into);
  }
}

/**
 * Recursively flattens a component tree: inline component objects found in
 * `children`/`child` are extracted into `flat`, and the references become ID
 * strings. Components without an `id` get a generated one. Returns the
 * component's id (or undefined for non-object entries).
 */
function flattenTree(
  node: unknown,
  gen: IdGenerator,
  flat: Record<string, unknown>[],
): string | undefined {
  if (!isRecord(node)) return undefined;

  const comp: Record<string, unknown> = { ...node };

  if (typeof comp.id !== 'string') {
    const hint = typeof comp.component === 'string' ? comp.component.toLowerCase() : 'component';
    comp.id = gen.next(hint);
  }

  // Pre-order: the parent is appended before its descendants. `flat` holds a
  // reference to `comp`, so the child-id assignments below are reflected in
  // the already-pushed entry.
  flat.push(comp);

  if (Array.isArray(comp.children)) {
    const childIds: string[] = [];
    for (const child of comp.children) {
      if (isRecord(child)) {
        const id = flattenTree(child, gen, flat);
        if (id !== undefined) childIds.push(id);
      } else if (typeof child === 'string') {
        childIds.push(child);
      }
      // other primitives are invalid — dropped (SDK would reject them anyway)
    }
    comp.children = childIds;
  }

  if (isRecord(comp.child)) {
    const id = flattenTree(comp.child, gen, flat);
    if (id !== undefined) comp.child = id;
  }

  return comp.id as string;
}

/** Coerces numeric strings in known numeric fields (spec: `weight: number`). */
function coerceNumerics(component: Record<string, unknown>): Record<string, unknown> {
  const out = { ...component };
  if (typeof out.weight === 'string' && out.weight.trim() !== '' && !Number.isNaN(Number(out.weight))) {
    out.weight = Number(out.weight);
  }
  return out;
}

/** Injects an inferred surfaceId into a payload that lacks one. */
function withInferredSurfaceId(
  payload: Record<string, unknown>,
  lastSurfaceId: string | undefined,
): Record<string, unknown> {
  if (typeof payload.surfaceId === 'string' || lastSurfaceId === undefined) return payload;
  return { surfaceId: lastSurfaceId, ...payload };
}

/**
 * Repairs an operations list per the rules in the module docblock. Returns a
 * new array; the input is not mutated.
 */
export function normalizeA2uiOperations(operations: unknown): unknown[] {
  if (!Array.isArray(operations)) return [];

  let lastSurfaceId: string | undefined;
  const out: unknown[] = [];

  for (const entry of operations) {
    if (!isRecord(entry)) {
      out.push(entry);
      continue;
    }

    const message: Record<string, unknown> = { ...entry };
    if (typeof message.version !== 'string') {
      message.version = 'v0.9'; // Rule 1
    }

    const presentKeys = PAYLOAD_KEYS.filter((key) => key in message);

    if (presentKeys.length === 0) {
      // Rule 2: bare payload — guess the message type from its fields.
      const { version: _version, ...rest } = message;
      const { surfaceId, ...payload } = rest;

      if (Array.isArray(payload.components) && Object.keys(payload).length === 1) {
        if (typeof surfaceId !== 'string' && lastSurfaceId === undefined) {
          out.push(message); // nothing inferable — version injected, shape left for SDK
          continue;
        }
        out.push({
          version: message.version,
          updateComponents: {
            ...(typeof surfaceId === 'string' ? { surfaceId } : { surfaceId: lastSurfaceId }),
            components: payload.components,
          },
        });
        continue;
      }

      if (
        payload.value !== undefined &&
        Object.keys(payload).length <= 2 &&
        (typeof surfaceId === 'string' || lastSurfaceId !== undefined)
      ) {
        out.push({
          version: message.version,
          updateDataModel: {
            ...(typeof surfaceId === 'string' ? { surfaceId } : { surfaceId: lastSurfaceId }),
            ...payload,
          },
        });
        continue;
      }

      out.push(message); // unknown shape — version injected, rest left for SDK
      continue;
    }

    if (presentKeys.length > 1) {
      // Rule 4: merged messages — split into one message per payload key.
      // PAYLOAD_KEYS order puts createSurface first, so a merged
      // createSurface+updateComponents message still infers the surfaceId.
      for (const key of presentKeys) {
        const payload = message[key];
        if (!isRecord(payload)) continue;
        const repaired = withInferredSurfaceId(payload, lastSurfaceId);
        if (key === 'updateComponents' && Array.isArray(repaired.components)) {
          const flat: Record<string, unknown>[] = [];
          const gen = new IdGenerator(collectIdsGen(repaired.components));
          for (const comp of repaired.components) flattenTree(comp, gen, flat);
          out.push({ version: message.version, updateComponents: { ...repaired, components: flat.map(coerceNumerics) } });
        } else {
          out.push({ version: message.version, [key]: repaired });
        }
        if (key === 'createSurface' && typeof repaired.surfaceId === 'string') {
          lastSurfaceId = repaired.surfaceId;
        }
      }
      continue;
    }

    // Single wrapped payload key.
    const key = presentKeys[0];
    if (key === undefined) {
      out.push(message);
      continue;
    }
    const payload = message[key];

    if (isRecord(payload)) {
      let repaired = withInferredSurfaceId(payload, lastSurfaceId); // Rule 3

      if (key === 'updateComponents') {
        if (typeof repaired.component === 'string' && !Array.isArray(repaired.components)) {
          // Rule 7: a single component object sent AS the updateComponents
          // payload (observed: `{component, id, ...}`) — wrap it in a list.
          const { surfaceId, ...component } = repaired;
          repaired = {
            ...(typeof surfaceId === 'string' ? { surfaceId } : {}),
            components: [component],
          };
        }
        if (Array.isArray(repaired.components)) {
          // Rule 5: flatten inline children into the flat list.
          const flat: Record<string, unknown>[] = [];
          const gen = new IdGenerator(collectIdsGen(repaired.components));
          for (const comp of repaired.components) flattenTree(comp, gen, flat);
          message[key] = { ...repaired, components: flat.map(coerceNumerics) }; // Rule 6
          out.push(message);
          continue;
        }
      } else {
        message[key] = repaired;
      }

      if (key === 'createSurface' && typeof repaired.surfaceId === 'string') {
        lastSurfaceId = repaired.surfaceId;
      }
    }

    out.push(message);
  }

  return out;
}

/** Collects all string ids in a component list (for collision-safe id generation). */
function collectIdsGen(components: unknown[]): Set<string> {
  const ids = new Set<string>();
  collectIds(components, ids);
  return ids;
}
