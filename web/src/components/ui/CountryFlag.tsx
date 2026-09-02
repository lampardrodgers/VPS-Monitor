import { countryFlag, countryLabel } from '@/lib/country'

export function CountryFlag({ code, className = '' }: { code: string | undefined; className?: string }) {
  return (
    <span
      className={`inline-block w-5 shrink-0 text-center text-base leading-none ${className}`}
      role={code ? 'img' : undefined}
      aria-label={code ? countryLabel(code) : undefined}
      title={code ? countryLabel(code) : undefined}
    >
      {code ? countryFlag(code) : null}
    </span>
  )
}
