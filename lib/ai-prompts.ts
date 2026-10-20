import { EMAIL_SHIPMENT_SYSTEM_PROMPT } from './email-shipment-ai.ts';
import { kimiExtractionPrompt, kimiPageImagePrompt, kimiRepairPrompt } from './kimi.ts';

export type AiPrompt = {
  id: 'extraction' | 'page-image' | 'repair' | 'email-matching';
  role: 'system' | 'user';
  text: string;
};
export type AiPromptsResponse = {
  model: string | null;
  prompts: AiPrompt[];
};

/** Read the very same instructions used by the live requests, without source files or credentials. */
export function currentAiPrompts(): AiPrompt[] {
  return [
    { id: 'extraction', role: 'system', text: kimiExtractionPrompt() },
    { id: 'page-image', role: 'user', text: kimiPageImagePrompt('{{pageNumber}}') },
    { id: 'repair', role: 'user', text: kimiRepairPrompt('{{validationFeedback}}') },
    { id: 'email-matching', role: 'system', text: EMAIL_SHIPMENT_SYSTEM_PROMPT },
  ];
}
