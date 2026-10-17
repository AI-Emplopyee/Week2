import type { Candidate } from './types.ts';

/** Factual official country names/codes, downloaded from the primary sources below.
 * Name matching is exact apart from case and whitespace; this never reads source
 * text, extracts a country from an address, or infers the origin of goods. */
export const COUNTRY_CODEBOOK_SOURCE = {
  "standard": "ISO 3166-1 alpha-2 country codes used by UN/LOCODE",
  "retrievedAt": "2026-10-16",
  "sources": [
    "https://unlocode.unece.org/directory/",
    "https://unstats.un.org/unsd/methodology/m49/overview",
    "https://unlocode.unece.org/recommendation16/"
  ],
  "entriesSha256": "c17837939f53a15a6c06cc8ada3de5a7b0afa9a516903fa53eca1d7ea424e2f8",
  "coverage": "249 ISO country/territory codes. UNECE non-ISO XZ is excluded; BV is supplied by UNSD. Names are exact published UNECE and UNSD names."
} as const;

export const COUNTRY_CODE_NAMES: Readonly<Record<string, readonly string[]>> = {
  "AD": [
    "Andorra"
  ],
  "AE": [
    "United Arab Emirates (the)",
    "United Arab Emirates"
  ],
  "AF": [
    "Afghanistan"
  ],
  "AG": [
    "Antigua and Barbuda"
  ],
  "AI": [
    "Anguilla"
  ],
  "AL": [
    "Albania"
  ],
  "AM": [
    "Armenia"
  ],
  "AO": [
    "Angola"
  ],
  "AQ": [
    "Antarctica"
  ],
  "AR": [
    "Argentina"
  ],
  "AS": [
    "American Samoa"
  ],
  "AT": [
    "Austria"
  ],
  "AU": [
    "Australia"
  ],
  "AW": [
    "Aruba"
  ],
  "AX": [
    "Åland Islands"
  ],
  "AZ": [
    "Azerbaijan"
  ],
  "BA": [
    "Bosnia and Herzegovina"
  ],
  "BB": [
    "Barbados"
  ],
  "BD": [
    "Bangladesh"
  ],
  "BE": [
    "Belgium"
  ],
  "BF": [
    "Burkina Faso"
  ],
  "BG": [
    "Bulgaria"
  ],
  "BH": [
    "Bahrain"
  ],
  "BI": [
    "Burundi"
  ],
  "BJ": [
    "Benin"
  ],
  "BL": [
    "Saint Barthélemy"
  ],
  "BM": [
    "Bermuda"
  ],
  "BN": [
    "Brunei Darussalam"
  ],
  "BO": [
    "Bolivia, Plurinational State of",
    "Bolivia (Plurinational State of)"
  ],
  "BQ": [
    "Bonaire, Sint Eustatius and Saba"
  ],
  "BR": [
    "Brazil"
  ],
  "BS": [
    "Bahamas"
  ],
  "BT": [
    "Bhutan"
  ],
  "BV": [
    "Bouvet Island"
  ],
  "BW": [
    "Botswana"
  ],
  "BY": [
    "Belarus"
  ],
  "BZ": [
    "Belize"
  ],
  "CA": [
    "Canada"
  ],
  "CC": [
    "Cocos (Keeling) Islands"
  ],
  "CD": [
    "Congo, The Democratic Republic of the",
    "Democratic Republic of the Congo"
  ],
  "CF": [
    "Central African Republic"
  ],
  "CG": [
    "Congo"
  ],
  "CH": [
    "Switzerland"
  ],
  "CI": [
    "Côte d'Ivoire",
    "Côte d’Ivoire"
  ],
  "CK": [
    "Cook Islands"
  ],
  "CL": [
    "Chile"
  ],
  "CM": [
    "Cameroon"
  ],
  "CN": [
    "China"
  ],
  "CO": [
    "Colombia"
  ],
  "CR": [
    "Costa Rica"
  ],
  "CU": [
    "Cuba"
  ],
  "CV": [
    "Cape Verde",
    "Cabo Verde"
  ],
  "CW": [
    "Curaçao"
  ],
  "CX": [
    "Christmas Island"
  ],
  "CY": [
    "Cyprus"
  ],
  "CZ": [
    "Czechia"
  ],
  "DE": [
    "Germany"
  ],
  "DJ": [
    "Djibouti"
  ],
  "DK": [
    "Denmark"
  ],
  "DM": [
    "Dominica"
  ],
  "DO": [
    "Dominican Republic"
  ],
  "DZ": [
    "Algeria"
  ],
  "EC": [
    "Ecuador"
  ],
  "EE": [
    "Estonia"
  ],
  "EG": [
    "Egypt"
  ],
  "EH": [
    "Western Sahara"
  ],
  "ER": [
    "Eritrea"
  ],
  "ES": [
    "Spain"
  ],
  "ET": [
    "Ethiopia"
  ],
  "FI": [
    "Finland"
  ],
  "FJ": [
    "Fiji"
  ],
  "FK": [
    "Falkland Islands (Malvinas)"
  ],
  "FM": [
    "Micronesia, Federated States of",
    "Micronesia (Federated States of)"
  ],
  "FO": [
    "Faroe Islands"
  ],
  "FR": [
    "France"
  ],
  "GA": [
    "Gabon"
  ],
  "GB": [
    "United Kingdom",
    "United Kingdom of Great Britain and Northern Ireland"
  ],
  "GD": [
    "Grenada"
  ],
  "GE": [
    "Georgia"
  ],
  "GF": [
    "French Guiana"
  ],
  "GG": [
    "Guernsey"
  ],
  "GH": [
    "Ghana"
  ],
  "GI": [
    "Gibraltar"
  ],
  "GL": [
    "Greenland"
  ],
  "GM": [
    "Gambia"
  ],
  "GN": [
    "Guinea"
  ],
  "GP": [
    "Guadeloupe"
  ],
  "GQ": [
    "Equatorial Guinea"
  ],
  "GR": [
    "Greece"
  ],
  "GS": [
    "South Georgia and the South Sandwich Islands"
  ],
  "GT": [
    "Guatemala"
  ],
  "GU": [
    "Guam"
  ],
  "GW": [
    "Guinea-Bissau"
  ],
  "GY": [
    "Guyana"
  ],
  "HK": [
    "Hong Kong",
    "China, Hong Kong Special Administrative Region"
  ],
  "HM": [
    "Heard Island and McDonald Islands"
  ],
  "HN": [
    "Honduras"
  ],
  "HR": [
    "Croatia"
  ],
  "HT": [
    "Haiti"
  ],
  "HU": [
    "Hungary"
  ],
  "ID": [
    "Indonesia"
  ],
  "IE": [
    "Ireland"
  ],
  "IL": [
    "Israel"
  ],
  "IM": [
    "Isle of Man"
  ],
  "IN": [
    "India"
  ],
  "IO": [
    "British Indian Ocean Territory"
  ],
  "IQ": [
    "Iraq"
  ],
  "IR": [
    "Iran, Islamic Republic of",
    "Iran (Islamic Republic of)"
  ],
  "IS": [
    "Iceland"
  ],
  "IT": [
    "Italy"
  ],
  "JE": [
    "Jersey"
  ],
  "JM": [
    "Jamaica"
  ],
  "JO": [
    "Jordan"
  ],
  "JP": [
    "Japan"
  ],
  "KE": [
    "Kenya"
  ],
  "KG": [
    "Kyrgyzstan"
  ],
  "KH": [
    "Cambodia"
  ],
  "KI": [
    "Kiribati"
  ],
  "KM": [
    "Comoros"
  ],
  "KN": [
    "Saint Kitts and Nevis"
  ],
  "KP": [
    "Korea, Democratic People's Republic of",
    "Democratic People's Republic of Korea"
  ],
  "KR": [
    "Korea, Republic of",
    "Republic of Korea"
  ],
  "KW": [
    "Kuwait"
  ],
  "KY": [
    "Cayman Islands"
  ],
  "KZ": [
    "Kazakhstan"
  ],
  "LA": [
    "Lao People's Democratic Republic"
  ],
  "LB": [
    "Lebanon"
  ],
  "LC": [
    "Saint Lucia"
  ],
  "LI": [
    "Liechtenstein"
  ],
  "LK": [
    "Sri Lanka"
  ],
  "LR": [
    "Liberia"
  ],
  "LS": [
    "Lesotho"
  ],
  "LT": [
    "Lithuania"
  ],
  "LU": [
    "Luxembourg"
  ],
  "LV": [
    "Latvia"
  ],
  "LY": [
    "Libya"
  ],
  "MA": [
    "Morocco"
  ],
  "MC": [
    "Monaco"
  ],
  "MD": [
    "Moldova, Republic of",
    "Republic of Moldova"
  ],
  "ME": [
    "Montenegro"
  ],
  "MF": [
    "Saint Martin (French Part)"
  ],
  "MG": [
    "Madagascar"
  ],
  "MH": [
    "Marshall Islands (the)",
    "Marshall Islands"
  ],
  "MK": [
    "North Macedonia"
  ],
  "ML": [
    "Mali"
  ],
  "MM": [
    "Myanmar"
  ],
  "MN": [
    "Mongolia"
  ],
  "MO": [
    "Macao",
    "China, Macao Special Administrative Region"
  ],
  "MP": [
    "Northern Mariana Islands (the)",
    "Northern Mariana Islands"
  ],
  "MQ": [
    "Martinique"
  ],
  "MR": [
    "Mauritania"
  ],
  "MS": [
    "Montserrat"
  ],
  "MT": [
    "Malta"
  ],
  "MU": [
    "Mauritius"
  ],
  "MV": [
    "Maldives"
  ],
  "MW": [
    "Malawi"
  ],
  "MX": [
    "Mexico"
  ],
  "MY": [
    "Malaysia"
  ],
  "MZ": [
    "Mozambique"
  ],
  "NA": [
    "Namibia"
  ],
  "NC": [
    "New Caledonia"
  ],
  "NE": [
    "Niger"
  ],
  "NF": [
    "Norfolk Island"
  ],
  "NG": [
    "Nigeria"
  ],
  "NI": [
    "Nicaragua"
  ],
  "NL": [
    "Netherlands",
    "Netherlands (Kingdom of the)"
  ],
  "NO": [
    "Norway"
  ],
  "NP": [
    "Nepal"
  ],
  "NR": [
    "Nauru",
    "Naoero"
  ],
  "NU": [
    "Niue"
  ],
  "NZ": [
    "New Zealand"
  ],
  "OM": [
    "Oman"
  ],
  "PA": [
    "Panama"
  ],
  "PE": [
    "Peru"
  ],
  "PF": [
    "French Polynesia"
  ],
  "PG": [
    "Papua New Guinea"
  ],
  "PH": [
    "Philippines (the)",
    "Philippines"
  ],
  "PK": [
    "Pakistan"
  ],
  "PL": [
    "Poland"
  ],
  "PM": [
    "Saint Pierre and Miquelon"
  ],
  "PN": [
    "Pitcairn"
  ],
  "PR": [
    "Puerto Rico"
  ],
  "PS": [
    "Palestine, State of",
    "State of Palestine"
  ],
  "PT": [
    "Portugal"
  ],
  "PW": [
    "Palau"
  ],
  "PY": [
    "Paraguay"
  ],
  "QA": [
    "Qatar"
  ],
  "RE": [
    "Réunion"
  ],
  "RO": [
    "Romania"
  ],
  "RS": [
    "Serbia"
  ],
  "RU": [
    "Russian Federation (the)",
    "Russian Federation"
  ],
  "RW": [
    "Rwanda"
  ],
  "SA": [
    "Saudi Arabia"
  ],
  "SB": [
    "Solomon Islands"
  ],
  "SC": [
    "Seychelles"
  ],
  "SD": [
    "Sudan (the)",
    "Sudan"
  ],
  "SE": [
    "Sweden"
  ],
  "SG": [
    "Singapore"
  ],
  "SH": [
    "Saint Helena, Ascension and Tristan Da Cunha",
    "Saint Helena"
  ],
  "SI": [
    "Slovenia"
  ],
  "SJ": [
    "Svalbard and Jan Mayen",
    "Svalbard and Jan Mayen Islands"
  ],
  "SK": [
    "Slovakia"
  ],
  "SL": [
    "Sierra Leone"
  ],
  "SM": [
    "San Marino"
  ],
  "SN": [
    "Senegal"
  ],
  "SO": [
    "Somalia"
  ],
  "SR": [
    "Suriname"
  ],
  "SS": [
    "South Sudan"
  ],
  "ST": [
    "Sao Tome and Principe"
  ],
  "SV": [
    "El Salvador"
  ],
  "SX": [
    "Sint Maarten (Dutch Part)"
  ],
  "SY": [
    "Syrian Arab Republic (the)",
    "Syrian Arab Republic"
  ],
  "SZ": [
    "Eswatini"
  ],
  "TC": [
    "Turks and Caicos Islands (the)",
    "Turks and Caicos Islands"
  ],
  "TD": [
    "Chad"
  ],
  "TF": [
    "French Southern Territories"
  ],
  "TG": [
    "Togo"
  ],
  "TH": [
    "Thailand"
  ],
  "TJ": [
    "Tajikistan"
  ],
  "TK": [
    "Tokelau"
  ],
  "TL": [
    "Timor-Leste"
  ],
  "TM": [
    "Turkmenistan"
  ],
  "TN": [
    "Tunisia"
  ],
  "TO": [
    "Tonga"
  ],
  "TR": [
    "Türkiye"
  ],
  "TT": [
    "Trinidad and Tobago"
  ],
  "TV": [
    "Tuvalu"
  ],
  "TW": [
    "Taiwan (Province of China)"
  ],
  "TZ": [
    "Tanzania, United Republic of",
    "United Republic of Tanzania"
  ],
  "UA": [
    "Ukraine"
  ],
  "UG": [
    "Uganda"
  ],
  "UM": [
    "United States Minor Outlying Islands"
  ],
  "US": [
    "United States of America (the)",
    "United States of America"
  ],
  "UY": [
    "Uruguay"
  ],
  "UZ": [
    "Uzbekistan"
  ],
  "VA": [
    "Holy See (Vatican City State)",
    "Holy See"
  ],
  "VC": [
    "Saint Vincent and the Grenadines"
  ],
  "VE": [
    "Venezuela (Bolivarian Republic of)"
  ],
  "VG": [
    "Virgin Islands (British)",
    "British Virgin Islands"
  ],
  "VI": [
    "Virgin Islands (U.S.)",
    "United States Virgin Islands"
  ],
  "VN": [
    "Viet Nam"
  ],
  "VU": [
    "Vanuatu"
  ],
  "WF": [
    "Wallis and Futuna",
    "Wallis and Futuna Islands"
  ],
  "WS": [
    "Samoa"
  ],
  "YE": [
    "Yemen"
  ],
  "YT": [
    "Mayotte"
  ],
  "ZA": [
    "South Africa"
  ],
  "ZM": [
    "Zambia"
  ],
  "ZW": [
    "Zimbabwe"
  ]
};
const nameKey = (value: string) => value.normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleUpperCase('en');
const namesToCode = new Map(Object.entries(COUNTRY_CODE_NAMES).flatMap(([code, names]) => names.map(name => [nameKey(name), code] as const)));
export function explicitOriginCountryCode(value: string): string | undefined {
  const key = nameKey(value);
  return Object.hasOwn(COUNTRY_CODE_NAMES, key) ? key : namesToCode.get(key);
}
export function isStandardOriginCountryCode(value: string): boolean {
  return Object.hasOwn(COUNTRY_CODE_NAMES, value.toUpperCase());
}

export const INCOTERM_SOURCE = 'https://2go.iccwbo.org/explore-our-products/ebooks/incoterms/incoterms-2020-introduction-free-document-pdf.html';
const currentIncoterms = new Set(['EXW', 'FCA', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP', 'FAS', 'FOB', 'CFR', 'CIF']);
// The supplied guide also lists older terms. Recognize them when detecting
// alternatives, so a phrase such as CIF / DDU cannot silently become CIF.
const incotermTokens = /\b(?:EXW|FCA|CPT|CIP|DAP|DPU|DDP|FAS|FOB|CFR|CIF|CNF|DAT|DAF|DDU|DES|DEQ|C&F|C&I)\b/gi;
export function explicitIncotermCode(value: string): string | undefined {
  const start = /^([a-z]{3})(?=$|[\s,;:.()\/-])/i.exec(value.trim())?.[1].toUpperCase();
  if (!start || !currentIncoterms.has(start)) return undefined;
  const tokens = new Set([...value.matchAll(incotermTokens)].map(match => match[0].toUpperCase()));
  return tokens.size === 1 && tokens.has(start) ? start : undefined;
}

/** A projection of an already grounded Kimi fact; saved source records stay intact. */
export function normalizeDeclarationCodeCandidate(candidate: Candidate): Candidate {
  if (!candidate.method.startsWith('kimi:')) return candidate;
  const value = candidate.field === 'incoterm' && !candidate.lineId ? explicitIncotermCode(candidate.value)
    : candidate.lineId && candidate.field === 'origin' ? explicitOriginCountryCode(candidate.value)
    : candidate.lineId && candidate.field === 'hsCode' && /^\d{4}(?:\.\d{2}){1,3}$/.test(candidate.value) ? candidate.value.replace(/\./g, '') : undefined;
  if (!value || value === candidate.value) return candidate;
  const reason = candidate.field === 'origin'
    ? `vnaccs-guide:1.79: Map the explicitly declared origin country using the verified ISO alpha-2 table used by UN/LOCODE; ${COUNTRY_CODEBOOK_SOURCE.sources.slice(0, 2).join('; ')} (retrieved ${COUNTRY_CODEBOOK_SOURCE.retrievedAt}, SHA-256 ${COUNTRY_CODEBOOK_SOURCE.entriesSha256}).`
    : candidate.field === 'incoterm'
      ? `vnaccs-guide:1.44: Keep the one explicit leading Incoterm token from the Kimi-selected delivery term, excluding its named place and edition without choosing between alternatives; ICC Incoterms 2020 codes: ${INCOTERM_SOURCE}.`
      : 'vnaccs-guide:1.74: Remove separators from an explicitly printed HS code, preserving every supplied digit without padding or tariff classification; HS digit structure: https://www.wcoomd.org/en/faq/harmonized_system_faq.';
  return { ...candidate, value, normalizations: [...candidate.normalizations, { before: candidate.value, after: value, reason }] };
}
