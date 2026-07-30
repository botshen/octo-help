const MAX_FIBER_DEPTH = 12;
const MAX_FIBER_NODES = 800;

function findFiberKey(element: Element): string | undefined {
  return Object.keys(element).find((key) => key.startsWith('__reactFiber$'));
}

/**
 * Read the MessageWrap attached to an Octo message row without mutating React.
 * Both recall restoration and pet notifications use this small, bounded walk.
 */
export function getMessageWrapFromItem(item: Element): any | null {
  const key = findFiberKey(item);
  if (!key) return null;
  const rootFiber = (item as Element & Record<string, unknown>)[key] as
    | { child?: unknown }
    | undefined;
  if (!rootFiber) return null;

  const stack: Array<{ fiber: any; depth: number }> = [
    { fiber: rootFiber.child, depth: 1 },
  ];
  let visited = 0;
  while (stack.length > 0 && visited < MAX_FIBER_NODES) {
    visited += 1;
    const node = stack.pop();
    if (!node?.fiber || node.depth > MAX_FIBER_DEPTH) continue;
    const { fiber, depth } = node;
    const props = fiber.memoizedProps;
    if (
      props &&
      typeof props === 'object' &&
      'message' in props &&
      props.message &&
      typeof props.message === 'object'
    ) {
      return props.message;
    }
    if (fiber.child) stack.push({ fiber: fiber.child, depth: depth + 1 });
    if (fiber.sibling) stack.push({ fiber: fiber.sibling, depth });
  }
  return null;
}
