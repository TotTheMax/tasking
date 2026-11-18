import { translateCard } from "../translate/card.js";

export function cardContentJson(card: unknown): string {
  return JSON.stringify(translateCard(card));
}

export function cardMessageBody(card: unknown): string {
  return JSON.stringify({ content: cardContentJson(card) });
}
