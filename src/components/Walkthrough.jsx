import React, { useEffect, useState } from 'react'

export default function Walkthrough({ steps = [], visible = false, onClose = () => {} }) {
  const [index, setIndex] = useState(0)
  const step = steps[index]
  const [pos, setPos] = useState(null)

  useEffect(() => {
    if (!visible) return
    const computePos = () => {
      if (!step || !step.selector) {
        setPos(null)
        return
      }
      try {
        const el = document.querySelector(step.selector)
        if (!el) { setPos(null); return }
        const r = el.getBoundingClientRect()
        // Store viewport-relative coords; the panel uses position:fixed and we
        // recompute on scroll/resize, so scroll offsets must NOT be baked in here.
        setPos({ top: r.top, left: r.left, width: r.width, height: r.height })
      } catch (e) {
        setPos(null)
      }
    }
    computePos()
    window.addEventListener('resize', computePos)
    window.addEventListener('scroll', computePos, true)
    return () => {
      window.removeEventListener('resize', computePos)
      window.removeEventListener('scroll', computePos, true)
    }
  }, [visible, index, step])

  if (!visible || !steps || steps.length === 0) return null

  const next = () => {
    if (index < steps.length - 1) setIndex(i => i + 1)
    else finish()
  }
  const prev = () => { if (index > 0) setIndex(i => i - 1) }
  const finish = () => { onClose(); setIndex(0) }

  // Positioning: prefer below target; if no space, render above; clamp horizontally
  const style = (() => {
    const base = { position: 'fixed', zIndex: 9999, minWidth: 220, maxWidth: 320 }
    if (!pos) return { ...base, top: '18%', left: '50%', transform: 'translateX(-50%)' }

    const panelMaxW = 320
    const margin = 8
    const panelEstimateH = 160 // conservative estimate for panel height
    const viewportW = window.innerWidth
    const viewportH = window.innerHeight

    // All coords are viewport-relative (pos comes from getBoundingClientRect).
    // compute left and clamp to viewport
    let left = pos.left
    if (left + panelMaxW + margin > viewportW) left = Math.max(margin, viewportW - panelMaxW - margin)
    if (left < margin) left = margin

    // prefer below target; if not enough space, place above
    let top = pos.top + pos.height + 8
    if (top + panelEstimateH + margin > viewportH) {
      // place above
      top = Math.max(margin, pos.top - panelEstimateH - 8)
    }

    return { ...base, position: 'fixed', top, left, minWidth: 220, maxWidth: panelMaxW }
  })()

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30" onClick={finish} />
      <div style={style} className="glass-card rounded-xl p-4 z-50">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1">
            <div className="text-xs text-gray-400 mb-1">Step {index + 1} of {steps.length}</div>
            <h3 className="font-semibold text-gray-900 mb-1">{step.title}</h3>
            <p className="text-sm text-gray-600">{step.body}</p>
          </div>
          <div className="ml-3 flex flex-col items-end gap-2">
            <button onClick={finish} className="text-xs text-gray-500">Skip</button>
            <div className="flex gap-2">
              {index > 0 && <button onClick={prev} className="px-2 py-1 text-xs bg-gray-100 rounded">Back</button>}
              <button onClick={next} className="px-3 py-1 text-xs bg-brand-600 text-white rounded">{index === steps.length - 1 ? 'Done' : 'Next'}</button>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
