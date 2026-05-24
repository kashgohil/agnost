// Proximity-based tool-call attribution. A tool call belongs to whichever
// user turn it directly responds to (most recent user turn before it in the
// same conversation). That user turn's intent's cluster is the tool call's
// cluster. See REASONING.md §2.

type TurnLite = {
  id: string;
  conversationId: string;
  turnIndex: number;
  role: string;
};

/** turn_id → preceding user turn id (or null). */
export function buildPrecedingUserTurnMap(turns: TurnLite[]): Map<string, string | null> {
  const sorted = [...turns].sort((a, b) =>
    a.conversationId === b.conversationId
      ? a.turnIndex - b.turnIndex
      : a.conversationId.localeCompare(b.conversationId),
  );

  const out = new Map<string, string | null>();
  let currentConv: string | null = null;
  let lastUserId: string | null = null;
  for (const t of sorted) {
    if (t.conversationId !== currentConv) {
      currentConv = t.conversationId;
      lastUserId = null;
    }
    out.set(t.id, lastUserId);
    if (t.role === "user") lastUserId = t.id;
  }
  return out;
}

/** turn_id → cluster_id of the tool calls it would carry. */
export function buildTurnClusterMap(
  precedingUser: Map<string, string | null>,
  turnIntent: Map<string, string>,
  intentCluster: Map<string, string | null>,
): Map<string, string | null> {
  const out = new Map<string, string | null>();
  for (const [turnId, userTurnId] of precedingUser) {
    if (!userTurnId) {
      out.set(turnId, null);
      continue;
    }
    const intent = turnIntent.get(userTurnId);
    if (!intent) {
      out.set(turnId, null);
      continue;
    }
    out.set(turnId, intentCluster.get(intent) ?? null);
  }
  return out;
}

export function isFailedToolStatus(status: string): boolean {
  return status === "error" || status === "empty_result";
}
