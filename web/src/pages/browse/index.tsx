// PLACEHOLDER — the Browse page agent overwrites this file.
// 1080px column per spec.
import type { ReactNode } from 'react'
import { SkeletonRows } from '../../components/Skeleton'
import { useHub } from '../../store'

export default function BrowsePage(): ReactNode {
  const { state, t } = useHub()
  return (
    <div className="mx-auto w-[1080px] max-w-full px-[24px] py-[20px]">
      <div className="voice-label pb-[10px]">{t('browse.title')}</div>
      {state ? (
        <div className="text-[13px] text-[var(--text-3)]">{t('browse.pickGame')}</div>
      ) : (
        <SkeletonRows rows={6} rowHeight={64} />
      )}
    </div>
  )
}
