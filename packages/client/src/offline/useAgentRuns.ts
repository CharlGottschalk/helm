import { useEffect, useState } from 'react'
import { agentRuns } from './mock'

/** Mock background runs that tick forward while you watch. */
export function useAgentRuns(wsId: string) {
  const [runs, setRuns] = useState(() => agentRuns.filter((r) => r.wsId === wsId))
  useEffect(() => {
    setRuns(agentRuns.filter((r) => r.wsId === wsId))
    const t = window.setInterval(() => {
      setRuns((rs) =>
        rs.map((r) => {
          if (r.status !== 'running') return r
          const progress = r.progress + Math.random() * 1.8
          return progress >= 100 ? { ...r, progress: 0 } : { ...r, progress }
        }),
      )
    }, 1200)
    return () => window.clearInterval(t)
  }, [wsId])
  return runs
}
