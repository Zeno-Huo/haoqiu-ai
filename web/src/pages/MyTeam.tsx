import { useState } from 'react'
import { getTeamProfile, newId, saveTeamProfile } from '../lib/storage'
import { POSITIONS, type Position, type TeamMember } from '../types'

function emptyMember(): TeamMember {
  return {
    id: newId('tm'),
    name: '',
    nickname: '',
    commonNumber: '',
    preferredPosition: '中场',
    createdAt: Date.now(),
  }
}

export default function MyTeam() {
  const initial = getTeamProfile()
  const [teamName, setTeamName] = useState(initial.name)
  const [members, setMembers] = useState<TeamMember[]>(initial.members.length ? initial.members : [emptyMember()])
  const [saved, setSaved] = useState(false)

  function updateMember(id: string, patch: Partial<TeamMember>) {
    setMembers((current) => current.map((member) => (member.id === id ? { ...member, ...patch } : member)))
    setSaved(false)
  }

  function save() {
    const cleanMembers = members
      .filter((member) => member.name.trim())
      .map((member) => ({ ...member, name: member.name.trim(), nickname: member.nickname?.trim(), commonNumber: member.commonNumber?.trim() }))
    saveTeamProfile({ id: initial.id, name: teamName.trim() || '我的球队', members: cleanMembers, updatedAt: Date.now() })
    setMembers(cleanMembers.length ? cleanMembers : [emptyMember()])
    setSaved(true)
  }

  return (
    <div className="page-shell px-4 py-10">
      <div className="mx-auto max-w-3xl">
        <header className="mb-7 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-3xl font-semibold text-[var(--text-primary)]">我的球队</h1>
            <p className="mt-2 max-w-xl text-sm leading-6 text-[var(--text-muted)]">
              先保存队员姓名、昵称和常用信息。每次上传后，AI 先整理画面候选人，再由队长确认是谁。
            </p>
          </div>
          <span className="status-text"><span className="status-dot" />{members.filter((member) => member.name).length} 名成员</span>
        </header>

        <section className="panel p-5 sm:p-6">
          <label className="field-label" htmlFor="team-name">球队名称</label>
          <input
            id="team-name"
            className="input-base max-w-md"
            value={teamName}
            onChange={(event) => { setTeamName(event.target.value); setSaved(false) }}
            placeholder="如：好球队"
          />

          <div className="mt-7 border-t border-[var(--line)] pt-5">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold text-[var(--text-primary)]">球队成员</h2>
                <p className="mt-1 text-xs text-[var(--text-muted)]">号码和位置都可以变化，这里只保存常用信息。</p>
              </div>
              <button className="btn-secondary !min-h-0 !px-3 !py-2" type="button" onClick={() => setMembers((current) => [...current, emptyMember()])}>
                + 添加成员
              </button>
            </div>

            <div className="space-y-2">
              {members.map((member, index) => (
                <div className="member-row" key={member.id}>
                  <span className="font-score text-xs text-[var(--text-muted)]">{String(index + 1).padStart(2, '0')}</span>
                  <input
                    className="input-base"
                    aria-label={`第 ${index + 1} 名成员姓名`}
                    placeholder="姓名或昵称"
                    value={member.name}
                    onChange={(event) => updateMember(member.id, { name: event.target.value })}
                  />
                  <input
                    className="input-base"
                    aria-label={`第 ${index + 1} 名成员昵称`}
                    placeholder="昵称（可选）"
                    value={member.nickname ?? ''}
                    onChange={(event) => updateMember(member.id, { nickname: event.target.value })}
                  />
                  <input
                    className="input-base"
                    aria-label={`第 ${index + 1} 名成员常用号码`}
                    placeholder="常用号码"
                    value={member.commonNumber ?? ''}
                    onChange={(event) => updateMember(member.id, { commonNumber: event.target.value })}
                  />
                  <select
                    className="input-base"
                    aria-label={`第 ${index + 1} 名成员常踢位置`}
                    value={member.preferredPosition}
                    onChange={(event) => updateMember(member.id, { preferredPosition: event.target.value as Position })}
                  >
                    {POSITIONS.map((position) => <option key={position}>{position}</option>)}
                  </select>
                  <button
                    className="member-remove"
                    type="button"
                    aria-label={`移除 ${member.name || `第 ${index + 1} 名成员`}`}
                    onClick={() => { setMembers((current) => current.filter((item) => item.id !== member.id)); setSaved(false) }}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-6 flex items-center justify-end gap-3">
            {saved && <span className="text-sm text-[var(--ai)]">球队资料已保存</span>}
            <button className="btn-primary" type="button" onClick={save}>保存球队</button>
          </div>
        </section>

        <p className="mt-5 text-xs leading-5 text-[var(--text-muted)]">
          球衣颜色、当场号码和外观不会作为永久身份。未来可在同日后续视频中优先沿用映射；当前 Demo 尚未实现该能力。
        </p>
      </div>
    </div>
  )
}
