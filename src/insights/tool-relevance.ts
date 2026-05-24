const TOOL_INTENT_PATTERNS: Array<{ pattern: RegExp; tools: string[] }> = [
  { pattern: /refund/, tools: ["process_refund"] },
  { pattern: /(shipping|address|redirect|rerout|package)/, tools: ["update_shipping_address"] },
  { pattern: /(order_status|find_old_order|lookup_order|order_lookup)/, tools: ["lookup_order"] },
  { pattern: /(inventory|stock|availability|product)/, tools: ["check_inventory", "recommend_product"] },
];

export function toolsForIntents(intents: string[]): Set<string> | null {
  const tools = new Set<string>();
  for (const intent of intents) {
    for (const rule of TOOL_INTENT_PATTERNS) {
      if (rule.pattern.test(intent)) {
        for (const tool of rule.tools) tools.add(tool);
      }
    }
  }
  return tools.size > 0 ? tools : null;
}

export function isFailedToolStatus(status: string): boolean {
  return status === "error" || status === "empty_result";
}
