// PLACEHOLDER — the Updates page agent overwrites this file.
// Keeps the shell compiling and demonstrates the 920px log column frame.
import type { ReactNode } from 'react'
import { SkeletonRows } from '../../components/Skeleton'
import { useHub } from '../../store'

export default function UpdatesPage(): ReactNode {
  const { state, t } = useHub()
  return (
    <div className="mx-auto w-[920px] max-w-full px-[24px] py-[20px]">
      <div className="voice-label pb-[10px]">{t('updates.missionLog')}</div>
      {state ? (
        <div className="text-[13px] text-[var(--text-3)]">{t('misc.loading')}</div>
      ) : (
        <SkeletonRows rows={8} rowHeight={64} />
      )}
    </div>
  )
}
