import { cx } from '../../lib/util'
import { isStreaming, useChromeTheme, useHelm, type TabKind } from '../../state/store'
import { Icon, type IconName } from '@helm/ui'
import s from './TabBar.module.css'

const tabIcon: Record<TabKind, IconName> = {
  dashboard: 'grid',
  chat: 'chat',
  graph: 'brain',
  project: 'folder',
  design: 'layers',
  tool: 'sliders',
  terminal: 'keyboard',
  session: 'spark',
  record: 'doc',
  projectGraph: 'layers',
}

export function TabBar() {
  const { state, online, tabSet, actions } = useHelm()
  const chrome = useChromeTheme()

  return (
    <div className={s.bar} data-theme={chrome}>
      <div className={s.tabs} role="tablist">
        {tabSet.tabs.map((tab) => {
          const active = tab.id === tabSet.activeId
          const chat = tab.kind === 'chat' ? state.chats[tab.refId!] : undefined
          const live = chat && isStreaming(chat)
          return (
            <div
              key={tab.id}
              role="tab"
              aria-selected={active}
              tabIndex={0}
              className={cx(s.tab, active && s.active, tab.kind === 'dashboard' && s.pinned)}
              onClick={() => actions.activateTab(tab.id)}
              onKeyDown={(e) => e.key === 'Enter' && actions.activateTab(tab.id)}
              onAuxClick={(e) => e.button === 1 && actions.closeTab(tab.id)}
              title={tab.title}
            >
              <Icon name={tabIcon[tab.kind]} size={14} />
              <span className={s.title}>{chat?.title ?? tab.title}</span>
              {live && <span className={s.live} />}
              {tab.kind !== 'dashboard' && (
                <button
                  className={s.close}
                  onClick={(e) => {
                    e.stopPropagation()
                    actions.closeTab(tab.id)
                  }}
                  aria-label={`Close ${tab.title}`}
                >
                  <Icon name="x" size={12} />
                </button>
              )}
            </div>
          )
        })}
        <button className={s.newTab} onClick={() => actions.startChat()} title="New chat">
          <Icon name="plus" size={14} />
        </button>
      </div>
      <div className={s.right}>
        {online ? (
          <span className={s.sys}>
            <span className={s.sysDot} /> SYS NOMINAL
          </span>
        ) : (
          <span className={cx(s.sys, s.offline)} title="No Helm server: showing sample data. Start it with `helm`.">
            <span className={s.sysDot} /> OFFLINE · SAMPLE DATA
          </span>
        )}
        <button className={s.iconBtn} onClick={actions.toggleRight} title={state.rightCollapsed ? 'Show sessions' : 'Hide sessions'}>
          <Icon name="panelR" size={15} />
        </button>
      </div>
    </div>
  )
}
