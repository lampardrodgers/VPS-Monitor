import type { InstanceRef, MetadataMap } from '@/api/types'
import { readPathText, readText } from '@/lib/values'
import { readStoredValue, removeStored, writeStored } from '@/lib/storage'

const ISO_COUNTRY_CODES = `AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW`.split(
  ' ',
)

const COUNTRY_CODE_SET = new Set(ISO_COUNTRY_CODES)

const COUNTRY_ALIASES: Record<string, string> = {
  UK: 'GB',
  USA: 'US',
  'UNITED STATES': 'US',
  'UNITED STATES OF AMERICA': 'US',
  美国: 'US',
  CHINA: 'CN',
  中国: 'CN',
  'HONG KONG': 'HK',
  香港: 'HK',
  JAPAN: 'JP',
  日本: 'JP',
  SINGAPORE: 'SG',
  新加坡: 'SG',
  GERMANY: 'DE',
  德国: 'DE',
  NETHERLANDS: 'NL',
  荷兰: 'NL',
  'UNITED KINGDOM': 'GB',
  英国: 'GB',
  CANADA: 'CA',
  加拿大: 'CA',
  AUSTRALIA: 'AU',
  澳大利亚: 'AU',
  'SOUTH KOREA': 'KR',
  KOREA: 'KR',
  韩国: 'KR',
  FRANCE: 'FR',
  法国: 'FR',
  TAIWAN: 'TW',
  台湾: 'TW',
}

const regionNames = new Intl.DisplayNames(['zh-CN'], { type: 'region' })
const englishRegionNames = new Intl.DisplayNames(['en'], { type: 'region' })
const countryNameCodes = new Map<string, string>()
for (const code of ISO_COUNTRY_CODES) {
  const englishName = englishRegionNames.of(code)
  const chineseName = regionNames.of(code)
  if (englishName) countryNameCodes.set(englishName.toUpperCase(), code)
  if (chineseName) countryNameCodes.set(chineseName.toUpperCase(), code)
}

export interface CountryOption {
  code: string
  label: string
  flag: string
}

export function countryFlag(code: string): string {
  return [...code.toUpperCase()]
    .map((letter) => String.fromCodePoint(letter.charCodeAt(0) + 127397))
    .join('')
}

export function countryLabel(code: string): string {
  const normalized = normalizeCountryCode(code)
  return normalized ? (regionNames.of(normalized) ?? normalized) : code
}

export const COUNTRY_OPTIONS: readonly CountryOption[] = ISO_COUNTRY_CODES.map((code) => ({
  code,
  label: countryLabel(code),
  flag: countryFlag(code),
})).sort((left, right) => left.label.localeCompare(right.label, 'zh-Hans-CN'))

export function filterCountryOptions(query: string): readonly CountryOption[] {
  const needle = query.trim().toLocaleLowerCase('zh-CN')
  if (!needle) return COUNTRY_OPTIONS
  return COUNTRY_OPTIONS.filter((country) => {
    const englishName = englishRegionNames.of(country.code) ?? ''
    const aliases = Object.entries(COUNTRY_ALIASES)
      .filter(([, code]) => code === country.code)
      .map(([alias]) => alias)
      .join(' ')
    return `${country.code} ${country.label} ${englishName} ${aliases}`
      .toLocaleLowerCase('zh-CN')
      .includes(needle)
  })
}

export function normalizeCountryCode(value: string | undefined): string | undefined {
  if (!value) return undefined
  const normalized = value.trim().toUpperCase()
  if (COUNTRY_ALIASES[normalized]) return COUNTRY_ALIASES[normalized]
  if (countryNameCodes.has(normalized)) return countryNameCodes.get(normalized)
  if (COUNTRY_CODE_SET.has(normalized)) return normalized

  for (const segment of normalized.split(/[,/|]/).map((part) => part.trim())) {
    if (COUNTRY_ALIASES[segment]) return COUNTRY_ALIASES[segment]
    if (countryNameCodes.has(segment)) return countryNameCodes.get(segment)
    if (COUNTRY_CODE_SET.has(segment)) return segment
  }

  const leadingCode = normalized.match(/^([A-Z]{2})(?:[-_\s,]|$)/)?.[1]
  return leadingCode && COUNTRY_CODE_SET.has(leadingCode) ? leadingCode : undefined
}

export function apiCountryCode(metadata: MetadataMap): string | undefined {
  const candidates = [
    ...[
      'country_code',
      'countryCode',
      'country_iso',
      'countryIso',
      'country',
      'country_name',
      'countryName',
      'location_country',
      'locationCountry',
    ].map((key) => readText(metadata, key)),
    readPathText(metadata, ['location', 'country_code']),
    readPathText(metadata, ['location', 'countryCode']),
    readPathText(metadata, ['location', 'country']),
    readPathText(metadata, ['datacenter', 'country_code']),
    readPathText(metadata, ['datacenter', 'country']),
    readText(metadata, 'node_location'),
    readText(metadata, 'region_id'),
  ]
  for (const candidate of candidates) {
    const code = normalizeCountryCode(candidate)
    if (code) return code
  }
  return undefined
}

export function instanceCountryStorageKey(ref: InstanceRef): string {
  return `instanceCountry.${encodeURIComponent(ref.provider)}.${encodeURIComponent(ref.instanceKey)}`
}

export function readInstanceCountry(ref: InstanceRef): string | undefined {
  return normalizeCountryCode(readStoredValue(instanceCountryStorageKey(ref)))
}

export function writeInstanceCountry(ref: InstanceRef, code: string): string | undefined {
  const normalized = normalizeCountryCode(code)
  if (normalized) writeStored(instanceCountryStorageKey(ref), normalized)
  else removeStored(instanceCountryStorageKey(ref))
  return normalized
}

export function clearInstanceCountry(ref: InstanceRef): void {
  removeStored(instanceCountryStorageKey(ref))
}
