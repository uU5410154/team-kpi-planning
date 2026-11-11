import { useCallback, useEffect, useRef, useState } from 'react'
import { SlideView } from './render.jsx'
import { W, H, FONT } from './theme.js'
import ProjectDrill from './ProjectDrill.jsx'

/*
 * PRESENTING: the deck full screen, one slide at a time.
 *
 * → / Space / Page Down for the next slide, ← / Page Up for the previous,
 * Home and End, Esc to stop. Anything on a slide that belongs to a project —
 * a card, a roadmap row, a task — opens that project when clicked, and Esc
 * closes it again without leaving the presentation. Hidden slides are skipped.
 */
export default function Present({ deck, brand, start = 0, projects, onClose }) {
  const slides = (deck.slides || []).filter((s) => !s.hidden)
  const [i, setI] = useState(Math.min(Math.max(0, start), Math.max(0, slides.length - 1)))
  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight })
  const [drill, setDrill] = useState(null)
  const [chrome, setChrome] = useState(true)
  const box = useRef(null)
  const idle = useRef(null)
  // The latest close, without re-running the full-screen set-up when the page redraws.
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  const go = useCallback((d) => setI((n) => Math.min(slides.length - 1, Math.max(0, n + d))), [slides.length])

  useEffect(() => {
    const el = box.current
    el?.requestFullscreen?.().catch(() => {})
    const onResize = () => setSize({ w: window.innerWidth, h: window.innerHeight })
    const onFs = () => { if (!document.fullscreenElement) closeRef.current() }
    window.addEventListener('resize', onResize)
    document.addEventListener('fullscreenchange', onFs)
    return () => {
      window.removeEventListener('resize', onResize)
      document.removeEventListener('fullscreenchange', onFs)
      if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {})
    }
  }, [])

  useEffect(() => {
    const k = (e) => {
      if (drill) return
      if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter'].includes(e.key)) { e.preventDefault(); go(1) }
      else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'].includes(e.key)) { e.preventDefault(); go(-1) }
      else if (e.key === 'Home') setI(0)
      else if (e.key === 'End') setI(slides.length - 1)
      else if (e.key === 'Escape') closeRef.current()
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [go, drill, slides.length])

  // The controls fade when the mouse is still, so the slide is all there is.
  const wake = () => {
    setChrome(true)
    clearTimeout(idle.current)
    idle.current = setTimeout(() => setChrome(false), 2500)
  }
  useEffect(() => { wake(); return () => clearTimeout(idle.current) }, [])

  const width = Math.min(size.w, (size.h * W) / H)
  const slide = slides[i]
  const btn = {
    background: 'rgba(255,255,255,0.12)', color: '#fff', border: '1px solid rgba(255,255,255,0.25)', borderRadius: 6,
    padding: '6px 14px', cursor: 'pointer', fontFamily: FONT, fontSize: 13,
  }
  return (
    <div
      ref={box}
      onMouseMove={wake}
      style={{ position: 'fixed', inset: 0, background: '#000', zIndex: 1600, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: chrome ? 'default' : 'none' }}
    >
      {slide ? (
        <div
          onClick={(e) => {
            // A click on the slide itself (not on a project) moves on, as in PowerPoint.
            if (e.target === e.currentTarget || e.target.closest('[data-advance]')) go(1)
          }}
        >
          <div data-advance>
            <SlideView slide={slide} brand={brand} width={width} onRef={(key) => setDrill(key)} />
          </div>
        </div>
      ) : (
        <div style={{ color: '#fff', fontFamily: FONT }}>This deck has no slides to show.</div>
      )}
      <div style={{
        position: 'fixed', left: 0, right: 0, bottom: 0, padding: 14, display: 'flex', justifyContent: 'center', gap: 8,
        opacity: chrome ? 1 : 0, transition: 'opacity .3s', pointerEvents: chrome ? 'auto' : 'none',
        background: 'linear-gradient(transparent, rgba(0,0,0,0.55))', alignItems: 'center',
      }}
      >
        <button type="button" style={btn} onClick={() => go(-1)} disabled={i === 0} aria-label="previous slide">‹ Previous</button>
        <span style={{ color: '#fff', fontFamily: FONT, fontSize: 13, minWidth: 70, textAlign: 'center' }}>{i + 1} / {slides.length}</span>
        <button type="button" style={btn} onClick={() => go(1)} disabled={i >= slides.length - 1} aria-label="next slide">Next ›</button>
        <span style={{ color: 'rgba(255,255,255,0.7)', fontFamily: FONT, fontSize: 12, margin: '0 12px' }}>Click a project to open it</span>
        <button type="button" style={btn} onClick={onClose}>Stop (Esc)</button>
      </div>
      {drill && <ProjectDrill projectKey={drill} project={projects?.find((p) => p.key === drill)} onClose={() => setDrill(null)} />}
    </div>
  )
}
