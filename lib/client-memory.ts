import { emptyDeclarationValue, getDeclarationEntry, validateDeclarationEntry } from './declaration.ts';
import { ecusFormValue, ecusFormValueUpdate, getEcusFormField } from './ecus-form.ts';
import type { DeclarationFieldEntry, SaveDeclarationFieldAction } from './declaration-types.ts';
import type { Actor, ShipmentCase, WorkspaceState } from './types.ts';

/** Client memory is local human knowledge. It is never an extraction source or model prompt. */
export const CLIENT_MEMORY_FIELD_KEYS = ['importerCode', 'importer', 'importerAddress', 'importerPostalCode', 'importerTelephone'] as const;
export type ClientMemoryFieldKey = typeof CLIENT_MEMORY_FIELD_KEYS[number];
export type ClientIdentity = { importerCode: string; name: string; address: string };
export type ClientMemory = {
  id: string; identity: ClientIdentity; identityAliases?: ClientIdentity[]; fieldKey: ClientMemoryFieldKey; value: string; previousValue: string;
  reason: string; basis: string; sourceCaseId: string; sourceReference: string; sourceCaseTitle: string;
  createdAt: string; createdBy: { id: string; name: string }; origin: 'human_correction'; status: 'active' | 'revoked';
  revokedAt?: string; revokedBy?: string;
};
export type ClientMemorySuggestion = { memory: ClientMemory; currentValue: string; match: 'importer_code' | 'name_and_address'; conflictsWithCurrent: boolean };
export type ClientMemoryAction =
  | { type: 'apply_client_memory'; caseId: string; memoryId: string; expectedValue: string }
  | { type: 'dismiss_client_memory'; caseId: string; memoryId: string }
  | { type: 'revoke_client_memory'; caseId: string; memoryId: string };
const normalized = (value: string) => value.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLocaleUpperCase('en-US');
const normalizedAddress = (value: string) => normalized(value).replace(/[,.]/gu, ' ').replace(/\s+/gu, ' ').trim();
const normalizedCode = (value: string) => normalized(value).replace(/\s+/gu, '');
function fieldValue(shipment: ShipmentCase, fieldKey: string): string {
  const field = getEcusFormField(fieldKey)!;
  const entry = getDeclarationEntry(shipment.declarationDraft, field.fieldId);
  return entry?.applicability === 'applicable' && !entry.stale ? ecusFormValue(field, shipment.declarationDraft).trim() : '';
}
export function getClientIdentity(shipment: ShipmentCase): ClientIdentity | undefined {
  const identity = { importerCode: normalizedCode(fieldValue(shipment, 'importerCode')), name: normalized(fieldValue(shipment, 'importer')), address: normalizedAddress(fieldValue(shipment, 'importerAddress')) };
  // IDs are taken from a dedicated field only. A company name alone is insufficient.
  if (identity.importerCode && !/^[A-Z0-9][A-Z0-9-]{2,39}$/u.test(identity.importerCode)) return undefined;
  return identity.importerCode || (identity.name && identity.address) ? identity : undefined;
}
export function matchClientIdentity(left: ClientIdentity, right: ClientIdentity): ClientMemorySuggestion['match'] | undefined {
  if (left.importerCode && right.importerCode) return left.importerCode === right.importerCode ? 'importer_code' : undefined;
  return left.name && left.address && left.name === right.name && left.address === right.address ? 'name_and_address' : undefined;
}
function memoryMatch(identity: ClientIdentity, memory: ClientMemory): ClientMemorySuggestion['match'] | undefined {
  // A known conflicting importer code always wins over any name/address alias.
  if (identity.importerCode && memory.identity.importerCode && identity.importerCode !== memory.identity.importerCode) return undefined;
  return matchClientIdentity(identity, memory.identity) ?? memory.identityAliases?.flatMap(alias => {
    // Aliases retain only the exact pre-correction company name and address; never an old tax code.
    if (alias.importerCode) return [];
    const match = matchClientIdentity(identity, alias);
    return match ? [match] : [];
  })[0];
}
function memorySourceCurrent(state: WorkspaceState, memory: ClientMemory): boolean {
  const source = state.cases.find(shipment => shipment.id === memory.sourceCaseId && !shipment.mergedInto);
  if (!source) return false;
  const field = getEcusFormField(memory.fieldKey)!;
  const entry = getDeclarationEntry(source.declarationDraft, field.fieldId);
  const identity = getClientIdentity(source);
  return !!identity && !!matchClientIdentity(memory.identity, identity) && !!entry && entry.generatedBy !== 'shipment_extraction' && !entry.stale &&
    entry.provenance.some(proof => proof.kind === 'manual' && proof.note.trim()) && fieldValue(source, memory.fieldKey) === memory.value;
}
export function getClientMemorySuggestions(state: WorkspaceState, shipment: ShipmentCase): ClientMemorySuggestion[] {
  const identity = getClientIdentity(shipment);
  if (!identity || shipment.caseType !== 'import' || shipment.mergedInto) return [];
  const seen = new Set<string>();
  return [...(state.clientMemories ?? [])].reverse().sort((a, b) => b.createdAt.localeCompare(a.createdAt)).flatMap(memory => {
    if (!memorySourceCurrent(state, memory) || state.cases.find(source => source.id === memory.sourceCaseId)?.synthetic !== shipment.synthetic) return [];
    const match = memoryMatch(identity, memory);
    if (!match || seen.has(memory.fieldKey)) return [];
    // The newest valid correction supersedes earlier values for this field. Dismissing,
    // revoking or already using it must never resurrect an older correction.
    seen.add(memory.fieldKey);
    const currentValue = ecusFormValue(getEcusFormField(memory.fieldKey)!, shipment.declarationDraft).trim();
    if (memory.status !== 'active' || memory.sourceCaseId === shipment.id || shipment.dismissedClientMemoryIds?.includes(memory.id) || currentValue === memory.value) return [];
    return [{ memory, currentValue, match, conflictsWithCurrent: !!currentValue }];
  });
}
/** Call only after an authenticated explicit form save; never during extraction/rebuild. */
export function rememberClientCorrection(state: WorkspaceState, shipment: ShipmentCase, action: SaveDeclarationFieldAction, before: DeclarationFieldEntry | null, actor: Actor, at: string, identityBefore?: ClientIdentity): ClientMemory | undefined {
  if (shipment.caseType !== 'import' || action.goodsLineId || action.applicability !== 'applicable' || !action.provenance.some(proof => proof.kind === 'manual' && proof.note.trim())) return undefined;
  const fieldKey = CLIENT_MEMORY_FIELD_KEYS.find(key => getEcusFormField(key)!.fieldId === action.fieldId);
  if (!fieldKey) return undefined;
  const field = getEcusFormField(fieldKey)!;
  const entry = getDeclarationEntry(shipment.declarationDraft, field.fieldId);
  const identity = getClientIdentity(shipment);
  if (!entry || entry.generatedBy === 'shipment_extraction' || entry.stale || !identity || validateDeclarationEntry(entry, { caseId: shipment.id, documents: state.documents, candidates: state.candidates, goods: shipment.goods }, shipment.declarationDraft).length) return undefined;
  const value = fieldValue(shipment, fieldKey);
  const previousValue = before ? ecusFormValue(field, { schemaVersion: 1, fields: [before] }).trim() : '';
  if (!value || value === previousValue || value.length > 1000) return undefined;
  const memory: ClientMemory = {
    id: `client-memory-${crypto.randomUUID()}`, identity,
    ...(['importer', 'importerAddress'].includes(fieldKey) && identityBefore?.name && identityBefore.address && (identityBefore.name !== identity.name || identityBefore.address !== identity.address) ? { identityAliases: [{ ...identityBefore, importerCode: '' }] } : {}),
    fieldKey, value, previousValue,
    reason: action.reason.trim(), basis: action.basis.trim(), sourceCaseId: shipment.id, sourceReference: shipment.reference, sourceCaseTitle: shipment.title,
    createdAt: at, createdBy: { id: actor.id, name: actor.name }, origin: 'human_correction', status: 'active',
  };
  state.clientMemories ??= [];
  state.clientMemories.push(memory);
  return memory;
}
export function clientMemorySaveAction(state: WorkspaceState, shipment: ShipmentCase, action: Extract<ClientMemoryAction, { type: 'apply_client_memory' }>): SaveDeclarationFieldAction {
  const suggestion = getClientMemorySuggestions(state, shipment).find(item => item.memory.id === action.memoryId);
  if (!suggestion || suggestion.currentValue !== action.expectedValue) throw new Error('This client suggestion or current form value has changed. Review the latest form before applying it.');
  const memory = suggestion.memory;
  const field = getEcusFormField(memory.fieldKey)!;
  const saved = getDeclarationEntry(shipment.declarationDraft, field.fieldId);
  const note = `Human client correction from ${memory.sourceReference} (${memory.createdAt}), entered by ${memory.createdBy.name}. ${memory.reason}`;
  return {
    type: 'save_declaration_field', caseId: shipment.id, fieldId: field.fieldId, applicability: 'applicable',
    value: ecusFormValueUpdate(field, saved?.value ?? emptyDeclarationValue(field.fieldId), memory.value),
    basis: `Explicitly applied remembered client information. ${memory.basis}`.slice(0, 4000),
    provenance: [{ kind: 'manual', note: note.slice(0, 4000) }], reason: `Applied client memory ${memory.id} from ${memory.sourceReference}.`, review: false,
  };
}
export function dismissOrRevokeClientMemory(state: WorkspaceState, shipment: ShipmentCase, action: Exclude<ClientMemoryAction, { type: 'apply_client_memory' }>, actor: Actor, at: string): ClientMemory {
  const identity = getClientIdentity(shipment);
  const memory = state.clientMemories?.find(item => item.id === action.memoryId && item.status === 'active');
  if (!identity || !memory || !memoryMatch(identity, memory)) throw new Error('This remembered information does not belong to the current client.');
  if (action.type === 'revoke_client_memory') { memory.status = 'revoked'; memory.revokedAt = at; memory.revokedBy = actor.id; }
  else shipment.dismissedClientMemoryIds = [...new Set([...(shipment.dismissedClientMemoryIds ?? []), memory.id])];
  return memory;
}
