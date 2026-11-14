// The backend uses this stored title to trigger automatic naming on the first turn.
export const untitledConversation = "新对话";

export function displayConversationTitle(title: string): string {
  return title === untitledConversation ? "New Chat" : title;
}
