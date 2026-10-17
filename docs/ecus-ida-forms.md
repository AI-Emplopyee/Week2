# ECUS IDA website forms

The October 15, 2026 update replaces the Working declaration / Prepare declaration editor with the import route **Tờ khai hải quan → Đăng ký mới tờ khai nhập khẩu (IDA)** and its first three tabs: **Thông tin chung**, **Thông tin chung 2**, and **Danh sách hàng**.

The capture layout follows the user's IMG_0777, IMG_0778, IMG_0780, IMG_0782, IMG_0783, IMG_0784 and IMG_0785 references. The photographed application identifies itself as ECUS5-VNACCS 2018, version 6.0.257. These images establish the requested website form, not current customs law or a supported ECUS import/transmission specification. The user's request controls behavior; help text and document contents are reference data only.

## Fields and requirements

`lib/ecus-form.ts` is the shared mapping used by the editor, Kimi's extraction field list, autofill, and requirement checks. It contains 191 visible controls, including repeating bill, permit, adjustment, attachment and transit slots.

Required general controls follow the visible red stars: declaration type, customs office, individual/organization classification, transport mode, exporter name and address, package count, arrival date, loading location code, invoice form, invoice price category, invoice total, invoice terms and invoice currency. Other header information is filled whenever the source supplies it. Optional blanks do not generate missing-field questions; supplied but conflicting or unclear information does.

The goods table contains all 25 requested columns. STT is assigned from the current row order. All other columns must contain an explicit value, including the second quantity/unit and every tax schedule, rate and amount. Zero is a value when explicitly provided; missing information is never filled with zero. Tax rates and amounts are copied, not calculated from assumed rates. “Thêm mới” appends a stable-ID blank row, and partial rows can be saved while their missing cells remain visible.

## Data and review

Existing `1.x` draft entries retain their shapes. Screenshot controls without equivalent fields use known `ecus.*` identifiers, validated through the catalog. Old fields outside the three-form layout remain accessible in a collapsed retained-fields section; removal requires a reason and remains in history.

Kimi can copy explicitly supplied HS, origin, tax codes/rates/amounts, and optional header values. Kimi must not invent customs codes, read source instructions as commands, or choose conflicting facts. Application rules can select a source or derive a code only where the supplied VNACCS guide explicitly supports the mapping and all source dependencies are clear. Source evidence and manual edits remain distinct. Required and evidence questions target the precise component and goods row. Once Kimi has read the active sources, unresolved questions automatically form one local email draft using those labels. Human email approval is required; the application does not send it.

Editing commercial goods cells in the form also updates the values used for source-table arithmetic and reports. A cell edit does not approve an entire goods row. Unsaved drafts survive switching tabs; saved values persist through the workspace API. Document replacement preserves manual decisions and raises source-review questions. Approval snapshots are retained.

## Remembered client corrections

An explicit human save can remember five stable importer fields: **importer code, importer name, importer address, importer postal code, and importer telephone**. The saved value must have a manual source, a reason and a valid declaration structure. Memory records retain the previous value, new value, basis, source shipment/reference, author and timestamp. Automatic extraction, routine confirmations without a value change and applying an existing memory do not create new learned facts.

A later shipment receives a suggestion only when its importer code matches, or when an exact normalized company name and address corroborate the identity. Conflicting importer codes block the match. A name/address correction can retain the exact previous name and address as a corroborated alias; an old importer code is never retained as an alias. Company names are not matched approximately, and demo corrections do not cross into real shipments. The source correction must still be current. Only the newest matching correction for each field is suggested; dismissing it or already using its value does not revive older suggestions.

The ECUS form shows remembered information separately from document evidence. **Apply** deliberately saves it as a manual source for the current shipment; it checks the current form value and workspace revision and does not approve the declaration. Unsaved edits must be resolved first. **Dismiss** hides that suggestion for this shipment. **Stop suggesting** revokes the remembered correction for future suggestions while preserving its audit history.

If remembered information could answer an automatic email question, the local email draft remains visible but cannot be approved until the person applies or dismisses the suggestion. Applying it can resolve the question; dismissing it allows the question to remain in the request. Changes to relevant remembered answers invalidate earlier email approval.

This is structured knowledge stored inside the workspace, not model training. Memories are not sent to Kimi. Shipment-specific invoice references, dates, quantities, weights, prices, bank information and tax rates are not reused as client defaults. Supplier details and the combined individual/organization classification are outside this five-field memory scope.

## Verification

Regression tests cover the screenshot mapping, all goods columns, required versus optional blanks, explicit zeros, repeating slots, source conflicts, partial rows, manual edits, row identity, immutable snapshots and report coverage. A live `kimi-k2.6` call on synthetic text returned 37 grounded facts with zero rejected facts, including every editable goods column, optional contract/date/payment information and six explicit zero values. Unsupplied customs office, declaration type and arrival date were left blank. This validates the test example, not extraction accuracy on every supplier layout.

The initial synthetic test used a disposable workspace. Subsequent user-authorized verification processes the four original shipment PDFs in the local workspace and preserves earlier human decisions. The test key is supplied through hidden stdin; the local launcher temporarily loads it through private Worker configuration and restores the previous configuration when that session stops. Keys are excluded from source, fixtures and exports. See [validation results](validation.md) for the live verification scope.

## Supplied-guide reconciliation

The supplied VNACCS DOCX is recorded by filename, SHA-256 and selected section text in `lib/vnaccs-guide-source.json`. The policies in `lib/vnaccs-guide-rules.ts` prefer the specified source for invoice, contract-seller and transport fields, preserve conflicting primary evidence, and map explicitly supported invoice form, party types, transport mode and payment-category facts. Source quotes and applied section numbers remain inspectable. No arbitrary document ranking is used for origin, weight or tax rates. Section 1.86 permits an absolute difference of at most 1 between line value and quantity × unit price.

The user-requested exporter reconciliation policy is separate from those guide rules. When no contract is available, clear commercial-invoice seller evidence corroborated by an explicitly labeled certificate-of-origin exporter and matching address can resolve a different secondary packing-list header. Punctuation and AND/& variants may share the invoice spelling; source quotes and crops stay unchanged. Conflicting primary names, addresses or identifiers remain unresolved. The saved draft includes the supporting identity evidence and labels this as source reconciliation, not a new legal requirement.

## Field evidence panel

Selecting a header field or goods cell shows its current value, source quote, filename/page and cropped image evidence in the right-hand panel. Numeric confidence is the model’s estimate and does not change the rules for clear evidence or human approval. Combined entries retain component-specific evidence: an invoice-number cell cannot borrow its date’s crop or score, and goods rows cannot borrow another row’s evidence. Manual input remains visibly distinct from Kimi readings.

Whitespace-only differences between a selected value and its quoted span do not create an evidence failure; the original quotation and image region are retained. Changed letters, digits, punctuation, order or intervening text still fail. Document-level invoice/contract identifiers and dates retain their header role even when Kimi supplies a goods-row index; that index is recorded in normalization history.

Explicit gross-weight totals can be reconciled in kilograms when every amount has one clear unit on the same page, including a unit quoted separately from a table heading. The exact lowercase symbol `t` means tonne, equal to 1,000 kg, following Table 8 of the [BIPM SI Brochure](https://www.bipm.org/en/web/guest/publications/si-brochure); uppercase `T` is not accepted as that symbol. Exact decimal arithmetic preserves the original readings and conversion reason. Unknown units, ambiguous “tons”, bare `MT`, missing units or multiple possible associations remain unresolved. Net/gross comparisons require explicit compatible source units. Comma-spacing differences in descriptive port names do not create conflicts; different names remain different.
