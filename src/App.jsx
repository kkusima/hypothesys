import React, { useState, useEffect, createContext, useContext, useRef, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { useAuth } from './contexts/AuthContext'
import { db, supabase } from './lib/supabase'
import Avatar from './components/Avatar'
import Walkthrough from './components/Walkthrough'
import TagPicker from './components/TagPicker'
import {
  Check, Plus, Trash2, Settings, ChevronLeft, ChevronRight,
  LogOut, Users, Share2, Mail, Clock, FileText, MessageSquare, Sun,
  Loader2, Search, MoreVertical, X, Copy, UserPlus, ChevronUp, ChevronDown, GripVertical,
  LayoutGrid, List, Bell, Calendar, AlertCircle, CheckCircle, Tag, Smartphone, RefreshCw, Kanban
} from 'lucide-react'

// App Context
const AppContext = createContext({})
const useApp = () => useContext(AppContext)

// Constants
const PRIORITIES = [
  { name: 'High', rank: 1, color: '#ef4444' },
  { name: 'Medium', rank: 2, color: '#f59e0b' },
  { name: 'Low', rank: 3, color: '#6b7280' }
]
const EMOJIS = [
  '🧪', '🔬', '📊', '🧬', '🔥', '💡', '🌱', '⚗️', '🔭', '💻', '📝', '🎯', '🚀', '⚡', '🧠', '🌍',
  '📚', '✨', '🎨', '🔧', '📈', '🏆', '💎', '🌟', '🎓', '📱', '🖥️', '🔐', '📡', '🛠️', '🏗️', '💼'
]
const STORAGE_KEY = 'hypothesys_local'
const TAGS_STORAGE_KEY = 'hypothesys_tags_local'

// Helpers
const uuid = () => crypto.randomUUID?.() || Math.random().toString(36).substr(2, 9) + Date.now().toString(36)
const getProgress = (p) => p.stages?.length ? (p.current_stage_index + 1) / p.stages.length : 0

const DEV = import.meta.env.DEV
const dlog = (...args) => { if (DEV) console.log(...args) }
const dwarn = (...args) => { if (DEV) console.warn(...args) }
const derr = (...args) => { if (DEV) console.error(...args) }

// Custom hook to ensure component is mounted on the client
const useMounted = () => {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  return mounted
}

// Check if a task/subtask is overdue
const isOverdue = (reminderDate) => {
  if (!reminderDate) return false
  return new Date(reminderDate) < new Date()
}

// Format date for input field (using local timezone)
const formatDateForInput = (dateString) => {
  if (!dateString) return ''
  const date = new Date(dateString)
  // Use local time components instead of UTC (toISOString uses UTC)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${year}-${month}-${day}T${hours}:${minutes}`
}

// Format reminder date for display
const formatReminderDate = (dateString) => {
  if (!dateString) return null
  const date = new Date(dateString)
  const now = new Date()
  const diffMs = date - now
  const absDiffMs = Math.abs(diffMs)
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)

  if (diffMs < 0) {
    // Overdue - calculate absolute values properly
    const absMins = Math.floor(absDiffMs / 60000)
    const absHours = Math.floor(absDiffMs / 3600000)
    const absDays = Math.floor(absDiffMs / 86400000)

    if (absDays >= 1) return `${absDays}d overdue`
    if (absHours >= 1) return `${absHours}h overdue`
    if (absMins >= 1) return `${absMins}m overdue`
    return 'Just overdue'
  }

  if (diffMins < 60) return `in ${diffMins}m`
  if (diffHours < 24) return `in ${diffHours}h`
  if (diffDays < 7) return `in ${diffDays}d`

  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// Format relative date (e.g., "2h ago", "3d ago", "Jan 5")
const formatRelativeDate = (dateString) => {
  if (!dateString) return null
  const date = new Date(dateString)
  const now = new Date()
  const diffMs = now - date
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)

  if (diffMins < 1) return 'Just now'
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 7) return `${diffDays}d ago`

  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// Format modified by text (e.g., "Modified 2h ago by John" or "Modified 2h ago" if same user)
const formatModifiedBy = (dateString, modifiedByName, currentUserName) => {
  if (!dateString) return null
  const relativeTime = formatRelativeDate(dateString)
  // If modified by name is available and different from current user, show it
  if (modifiedByName && modifiedByName !== currentUserName) {
    // Get first name only
    const firstName = modifiedByName.split(' ')[0].split('@')[0]
    return `${relativeTime} by ${firstName}`
  }
  return relativeTime
}

// Get the latest updated timestamp for a project by checking project, its stages, tasks and subtasks
const getProjectLatestUpdatedAt = (project) => {
  if (!project) return null
  let latest = project.updated_at || project.created_at || null
  try {
    (project.stages || []).forEach(stage => {
      (stage.tasks || []).forEach(task => {
        if (task.updated_at && (!latest || new Date(task.updated_at) > new Date(latest))) latest = task.updated_at
          (task.subtasks || []).forEach(st => {
            if (st.updated_at && (!latest || new Date(st.updated_at) > new Date(latest))) latest = st.updated_at
          })
      })
    })
  } catch (e) {
    // ignore
  }
  return latest
}

// Local storage helpers for demo mode
const loadLocal = () => {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || []
  } catch {
    return []
  }
}
const saveLocal = (data) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  } catch { }
}

// ============================================
// LOGIN PAGE
// ============================================
function LoginPage() {
  const { signInWithGoogle, signInWithEmail, signUpWithEmail, sendPasswordReset, demoMode } = useAuth()
  const [googleLoading, setGoogleLoading] = useState(false)
  const [formLoading, setFormLoading] = useState(false)
  const [resetLoading, setResetLoading] = useState(false)
  const [isSignUp, setIsSignUp] = useState(false)
  const [isForgotPassword, setIsForgotPassword] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [confirmationSent, setConfirmationSent] = useState(false)
  const [resetEmailSent, setResetEmailSent] = useState(false)

  const handleGoogleLogin = async () => {
    setGoogleLoading(true)
    setError('')
    await signInWithGoogle()
    setGoogleLoading(false)
  }

  const handleEmailSubmit = async (e) => {
    e.preventDefault()
    setFormLoading(true)
    setError('')
    setConfirmationSent(false)

    if (isSignUp) {
      const { error, confirmationRequired } = await signUpWithEmail(email, password, name)
      if (error) {
        setError(error.message)
      } else if (confirmationRequired) {
        setConfirmationSent(true)
      }
    } else {
      const { error } = await signInWithEmail(email, password)
      if (error) {
        setError(error.message)
      }
    }
    setFormLoading(false)
  }

  const handleForgotPassword = async (e) => {
    e.preventDefault()
    setResetLoading(true)
    setError('')

    const { error } = await sendPasswordReset(email)
    if (error) {
      setError(error.message)
    } else {
      setResetEmailSent(true)
    }
    setResetLoading(false)
  }

  // Show password reset email sent message
  if (resetEmailSent) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4" style={{ background: 'linear-gradient(135deg, #f3f4f6 0%, #6b7280 100%)' }}>
        <div className="glass-card rounded-3xl p-8 w-full max-w-md text-center animate-fade-in">
          <div className="w-20 h-20 mx-auto mb-6 rounded-2xl flex items-center justify-center text-4xl bg-blue-100">
            🔐
          </div>
          <h1 className="text-2xl font-extrabold text-gray-900 mb-2">Check Your Email</h1>
          <p className="text-gray-600 mb-4">
            We've sent a password reset link to <strong>{email}</strong>
          </p>
          <p className="text-gray-500 text-sm mb-6">
            Click the link in the email to reset your password, then come back here to sign in.
          </p>
          <button
            onClick={() => { setResetEmailSent(false); setIsForgotPassword(false); }}
            className="w-full px-6 py-3 bg-gray-800 text-white rounded-xl font-semibold hover:bg-gray-700 transition-all"
          >
            Back to Sign In
          </button>
        </div>
        <p className="absolute bottom-4 left-0 right-0 text-center text-[10px] text-gray-400">
          © 2026 <a href="http://tinyurl.com/kennethkusima" target="_blank" rel="noopener noreferrer" className="hover:text-gray-600 underline">Kenneth Kusima</a>. All rights reserved.
        </p>
      </div>
    )
  }

  // Show confirmation message after sign up
  if (confirmationSent) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4" style={{ background: 'linear-gradient(135deg, #f3f4f6 0%, #6b7280 100%)' }}>
        <div className="glass-card rounded-3xl p-8 w-full max-w-md text-center animate-fade-in">
          <div className="w-20 h-20 mx-auto mb-6 rounded-2xl flex items-center justify-center text-4xl bg-green-100">
            ✉️
          </div>
          <h1 className="text-2xl font-extrabold text-gray-900 mb-2">Check Your Email</h1>
          <p className="text-gray-600 mb-4">
            We've sent a confirmation link to <strong>{email}</strong>
          </p>
          <p className="text-gray-500 text-sm mb-6">
            Click the link in the email to verify your account, then come back here to sign in.
          </p>
          <button
            onClick={() => { setConfirmationSent(false); setIsSignUp(false); }}
            className="w-full px-6 py-3 bg-gray-800 text-white rounded-xl font-semibold hover:bg-gray-700 transition-all"
          >
            Back to Sign In
          </button>
        </div>
        <p className="absolute bottom-4 left-0 right-0 text-center text-[10px] text-gray-400">
          © 2026 <a href="http://tinyurl.com/kennethkusima" target="_blank" rel="noopener noreferrer" className="hover:text-gray-600 underline">Kenneth Kusima</a>. All rights reserved.
        </p>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: 'radial-gradient(circle at 20% 20%, #eef2ff 0, #f9fafb 45%, #e5e7eb 100%)' }}>
      <div className="glass-card rounded-3xl p-8 w-full max-w-md text-center animate-fade-in shadow-xl border border-gray-100/60">
        <div className="flex items-center justify-between mb-6">
          <div className="text-left">
            <p className="text-xs uppercase tracking-[0.2em] text-gray-400 mb-1">Welcome to</p>
            <h1 className="text-3xl font-black text-gray-900">HypotheSys™</h1>
          </div>
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center text-2xl" style={{ background: 'linear-gradient(135deg, #e0f2fe, #eef2ff)' }}>
            🔬
          </div>
        </div>
        <p className="text-gray-500 mb-4">Systematize your hypothesis-to-discovery workflow.</p>

        <div className="bg-gray-100 rounded-2xl p-1 grid grid-cols-2 text-sm font-semibold mb-5">
          <button
            className={`py-2 rounded-xl transition-all ${!isSignUp ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500'}`}
            onClick={() => { setIsSignUp(false); setIsForgotPassword(false); setError('') }}
          >
            Sign In
          </button>
          <button
            className={`py-2 rounded-xl transition-all ${isSignUp ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500'}`}
            onClick={() => { setIsSignUp(true); setIsForgotPassword(false); setError('') }}
          >
            Create Account
          </button>
        </div>

        <button
          onClick={handleGoogleLogin}
          disabled={googleLoading}
          className="w-full flex items-center justify-center gap-3 px-6 py-4 bg-white border-2 border-gray-200 rounded-xl font-semibold text-gray-700 hover:bg-gray-50 hover:border-gray-300 transition-all disabled:opacity-60 mb-4"
        >
          {googleLoading ? (
            <Loader2 className="w-5 h-5 animate-spin" />
          ) : (
            <svg className="w-5 h-5" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
            </svg>
          )}
          Continue with Google
        </button>

        <div className="relative mb-6">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-gray-200"></div>
          </div>
          <div className="relative flex justify-center text-sm">
            <span className="px-3 bg-white text-gray-400">or email</span>
          </div>
        </div>

        {/* Forgot Password Form */}
        {isForgotPassword ? (
          <>
            <form onSubmit={handleForgotPassword} className="text-left">
              <p className="text-sm text-gray-600 mb-4">
                Enter your email address and we'll send you a link to reset your password.
              </p>
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  required
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-400 focus:border-transparent"
                />
              </div>

              {error && (
                <p className="text-sm text-red-600 bg-red-50 rounded-lg p-2 mb-4">{error}</p>
              )}

              <button
                type="submit"
                disabled={resetLoading}
                className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-gray-800 text-white rounded-xl font-semibold hover:bg-gray-700 transition-all disabled:opacity-50"
              >
                {resetLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : null}
                Send Reset Link
              </button>
            </form>

            <button
              onClick={() => { setIsForgotPassword(false); setError(''); }}
              className="text-sm text-gray-500 hover:text-gray-700 mt-4"
            >
              Back to Sign In
            </button>
          </>
        ) : (
          <>
            {/* Email/Password Form */}
            <form onSubmit={handleEmailSubmit} className="text-left">
              {isSignUp && (
                <div className="mb-3">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Your name"
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-400 focus:border-transparent"
                  />
                </div>
              )}
              <div className="mb-3">
                <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  required
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-400 focus:border-transparent"
                />
              </div>
              <div className="mb-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  minLength={6}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-400 focus:border-transparent"
                />
              </div>

              {!isSignUp && (
                <div className="text-right mb-4">
                  <button
                    type="button"
                    onClick={() => { setIsForgotPassword(true); setError(''); }}
                    className="text-sm text-gray-500 hover:text-gray-700"
                  >
                    Forgot Password?
                  </button>
                </div>
              )}

              {isSignUp && <div className="mb-4" />}

              {error && (
                <p className="text-sm text-red-600 bg-red-50 rounded-lg p-2 mb-4">{error}</p>
              )}

              <button
                type="submit"
                disabled={formLoading}
                className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-gray-800 text-white rounded-xl font-semibold hover:bg-gray-700 transition-all disabled:opacity-50"
              >
                {formLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : null}
                {isSignUp ? 'Create Account' : 'Sign In'}
              </button>
            </form>

            <button
              onClick={() => { setIsSignUp(!isSignUp); setError(''); }}
              className="text-sm text-gray-700 font-semibold hover:text-gray-900 mt-4"
            >
              {isSignUp ? 'Already have an account? Sign in' : 'New here? Create your account'}
            </button>
          </>
        )}

        {demoMode && (
          <p className="mt-4 text-sm text-amber-600 bg-amber-50 rounded-lg p-3">
            ⚠️ Running in demo mode. Data saved locally only.
          </p>
        )}

        <div className="mt-6 pt-6 border-t border-gray-200">
          <p className="text-xs text-gray-400">
            By continuing, you agree to our Terms of Service and Privacy Policy
          </p>
        </div>
      </div>

      <p className="absolute bottom-4 left-0 right-0 text-center text-[10px] text-gray-400">
        © 2026 <a href="http://tinyurl.com/kennethkusima" target="_blank" rel="noopener noreferrer" className="hover:text-gray-600 underline">Kenneth Kusima</a>. All rights reserved.
      </p>
    </div>
  )
}

// ============================================
// GLOBAL SEARCH COMPONENT
// ============================================
function GlobalSearch({ projects, onNavigate }) {
  const [query, setQuery] = useState('')
  const [isOpen, setIsOpen] = useState(false)
  const [results, setResults] = useState({ projects: [], tasks: [], subtasks: [] })
  const inputRef = useRef(null)

  useEffect(() => {
    if (!query.trim()) {
      setResults({ projects: [], tasks: [], subtasks: [] })
      return
    }

    const q = query.toLowerCase()
    const matchedProjects = []
    const matchedTasks = []
    const matchedSubtasks = []

    projects.forEach(project => {
      // Search projects
      if (project.title.toLowerCase().includes(q)) {
        matchedProjects.push(project)
      }

      // Search tasks and subtasks
      project.stages?.forEach((stage, stageIndex) => {
        stage.tasks?.forEach(task => {
          if (task.title.toLowerCase().includes(q)) {
            matchedTasks.push({ project, stage, stageIndex, task })
          }

          // Search subtasks
          task.subtasks?.forEach(subtask => {
            if (subtask.title.toLowerCase().includes(q)) {
              matchedSubtasks.push({ project, stage, stageIndex, task, subtask })
            }
          })
        })
      })
    })

    setResults({
      projects: matchedProjects.slice(0, 5),
      tasks: matchedTasks.slice(0, 5),
      subtasks: matchedSubtasks.slice(0, 5)
    })
  }, [query, projects])

  const hasResults = results.projects.length > 0 || results.tasks.length > 0 || results.subtasks.length > 0

  const containerRef = useRef(null)
  const [anchorRect, setAnchorRect] = useState(null)

  useEffect(() => {
    if (isOpen) {
      setAnchorRect(containerRef.current?.getBoundingClientRect())
    }
  }, [isOpen])

  const mounted = useMounted()

  const handleSelect = (type, item) => {
    setQuery('')
    setIsOpen(false)
    onNavigate(type, item)
  }

  return (
    <div ref={containerRef} className="relative flex-1 max-w-md">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
      <input
        ref={inputRef}
        type="text"
        placeholder="Search projects, tasks, subtasks..."
        value={query}
        onChange={e => { setQuery(e.target.value); setIsOpen(true) }}
        onFocus={() => setIsOpen(true)}
        className="w-full pl-10 pr-4 py-2 bg-gray-100 border border-transparent rounded-xl text-sm focus:bg-white focus:border-gray-300 focus:ring-2 focus:ring-gray-200 transition-all"
      />

      {mounted && isOpen && query.trim() && anchorRect && typeof document !== 'undefined' && createPortal(
        <>
          <div className="fixed inset-0 z-[100]" onClick={() => setIsOpen(false)} />
          <div
            className="fixed mt-2 glass-card rounded-xl shadow-xl z-[101] max-h-96 overflow-y-auto animate-fade-in"
            style={{
              top: anchorRect.bottom,
              left: anchorRect.left,
              width: anchorRect.width
            }}
          >
            {!hasResults ? (
              <div className="p-4 text-center text-gray-500 text-sm">
                No results found for "{query}"
              </div>
            ) : (
              <div className="py-2">
                {/* Projects */}
                {results.projects.length > 0 && (
                  <div>
                    <div className="px-4 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wider">Projects</div>
                    {results.projects.map(project => (
                      <button
                        key={project.id}
                        onClick={() => handleSelect('project', { project })}
                        className="w-full px-4 py-2 text-left hover:bg-gray-50 flex items-center gap-3"
                      >
                        <span className="text-xl">{project.emoji}</span>
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-gray-900 truncate">{project.title}</div>
                          <div className="text-xs text-gray-500">{project.stages?.length || 0} stages</div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}

                {/* Tasks */}
                {results.tasks.length > 0 && (
                  <div>
                    <div className="px-4 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wider border-t border-gray-100 mt-2">Tasks</div>
                    {results.tasks.map(({ project, stage, stageIndex, task }) => (
                      <button
                        key={`${project.id}-${task.id}`}
                        onClick={() => handleSelect('task', { project, task, stageIndex })}
                        className="w-full px-4 py-2 text-left hover:bg-gray-50 flex items-center gap-3"
                      >
                        <span className="text-xl">{project.emoji}</span>
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-gray-900 truncate">{task.title}</div>
                          <div className="text-xs text-gray-500 flex items-center gap-2">
                            <span>{project.title}</span>
                            <span className="tag tag-default text-[9px]">{stage.name}</span>
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}

                {/* Subtasks */}
                {results.subtasks.length > 0 && (
                  <div>
                    <div className="px-4 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wider border-t border-gray-100 mt-2">Subtasks</div>
                    {results.subtasks.map(({ project, stage, stageIndex, task, subtask }) => (
                      <button
                        key={`${project.id}-${task.id}-${subtask.id}`}
                        onClick={() => handleSelect('task', { project, task, stageIndex })}
                        className="w-full px-4 py-2 text-left hover:bg-gray-50 flex items-center gap-3"
                      >
                        <span className="text-xl">{project.emoji}</span>
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-gray-900 truncate">{subtask.title}</div>
                          <div className="text-xs text-gray-500 flex items-center gap-2">
                            <span className="truncate">{task.title}</span>
                            <span>•</span>
                            <span className="truncate">{project.title}</span>
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </>,
        document.body
      )}
    </div>
  )
}

// ============================================
// NOTIFICATION PANE
// ============================================
function NotificationPane({ notifications, onMarkRead, onMarkUnread, onMarkAllRead, onDelete, onDeleteMultiple, onClear, onNavigate, onClose, onOpenSettings, position }) {
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [isSelectionMode, setIsSelectionMode] = useState(false)
  const unreadCount = notifications.filter(n => !n.is_read).length
  const readCount = notifications.filter(n => n.is_read).length

  const toggleSelection = (id, e) => {
    e.stopPropagation()
    const newSelected = new Set(selectedIds)
    if (newSelected.has(id)) {
      newSelected.delete(id)
    } else {
      newSelected.add(id)
    }
    setSelectedIds(newSelected)
  }

  const selectAll = () => {
    if (selectedIds.size === notifications.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(notifications.map(n => n.id)))
    }
  }

  const handleDeleteSelected = () => {
    if (selectedIds.size > 0 && onDeleteMultiple) {
      onDeleteMultiple(Array.from(selectedIds))
      setSelectedIds(new Set())
      setIsSelectionMode(false)
    }
  }

  const getNotificationIcon = (type) => {
    switch (type) {
      case 'task_reminder':
      case 'subtask_reminder':
        return <Clock className="w-4 h-4 text-amber-500" />
      case 'task_overdue':
      case 'subtask_overdue':
        return <AlertCircle className="w-4 h-4 text-red-500" />
      case 'project_shared':
      case 'project_invite':
        return <Users className="w-4 h-4 text-blue-500" />
      case 'task_created':
      case 'subtask_created':
        return <Plus className="w-4 h-4 text-green-500" />
      case 'task_reminder_set':
      case 'subtask_reminder_set':
        return <Clock className="w-4 h-4 text-purple-500" />
      default:
        return <Bell className="w-4 h-4 text-gray-500" />
    }
  }

  if (!position) return null

  return (
    <>
      <div className="fixed inset-0 z-[100]" onClick={onClose} />
      <div
        className="fixed glass-card rounded-xl shadow-xl z-[101] animate-fade-in max-h-[70vh] flex flex-col w-80 sm:w-96"
        onClick={e => e.stopPropagation()}
        style={{
          top: position.top,
          right: position.right
        }}
      >
        <div className="flex items-center justify-between p-4 border-b border-gray-100">
          <h3 className="font-semibold text-gray-900">
            Notifications
            {unreadCount > 0 && (
              <span className="ml-2 px-1.5 py-0.5 text-xs bg-red-100 text-red-600 rounded-full">
                {unreadCount}
              </span>
            )}
          </h3>
          <div className="flex items-center gap-2">
            {onOpenSettings && (
              <button
                onClick={onOpenSettings}
                className="text-xs text-gray-400 hover:text-gray-600 flex items-center gap-1"
                title="Notification Settings"
              >
                <Settings className="w-3.5 h-3.5" />
              </button>
            )}
            {notifications.length > 0 && (
              <button
                onClick={() => { setIsSelectionMode(!isSelectionMode); setSelectedIds(new Set()) }}
                className={`text-xs ${isSelectionMode ? 'text-brand-600 font-medium' : 'text-gray-400 hover:text-gray-600'}`}
              >
                {isSelectionMode ? 'Cancel' : 'Select'}
              </button>
            )}
          </div>
        </div>

        {/* Selection mode toolbar */}
        {isSelectionMode && notifications.length > 0 && (
          <div className="flex items-center justify-between px-4 py-2 bg-gray-50 border-b border-gray-100">
            <button
              onClick={selectAll}
              className="text-xs text-brand-600 hover:text-brand-700"
            >
              {selectedIds.size === notifications.length ? 'Deselect all' : 'Select all'}
            </button>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500">{selectedIds.size} selected</span>
              {selectedIds.size > 0 && (
                <button
                  onClick={handleDeleteSelected}
                  className="text-xs text-red-500 hover:text-red-600 font-medium"
                >
                  Delete selected
                </button>
              )}
            </div>
          </div>
        )}

        {/* Normal mode toolbar */}
        {!isSelectionMode && notifications.length > 0 && (
          <div className="flex items-center justify-end gap-2 px-4 py-2 bg-gray-50 border-b border-gray-100">
            {unreadCount > 0 && (
              <button
                onClick={onMarkAllRead}
                className="text-xs text-brand-600 hover:text-brand-700"
              >
                Mark all read
              </button>
            )}
            <button
              onClick={onClear}
              className="text-xs text-red-400 hover:text-red-500"
            >
              Clear all
            </button>
          </div>
        )}

        <div className="flex-1 overflow-y-auto">
          {notifications.length === 0 ? (
            <div className="p-8 text-center text-gray-400">
              <Bell className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm">No notifications yet</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-50">
              {notifications.map(notif => (
                <div
                  key={notif.id}
                  className={`p-3 hover:bg-gray-50 transition-colors cursor-pointer ${!notif.is_read ? 'bg-blue-50/50' : ''
                    } ${selectedIds.has(notif.id) ? 'bg-brand-50 ring-1 ring-brand-200' : ''}`}
                  onClick={() => {
                    if (isSelectionMode) {
                      const newSelected = new Set(selectedIds)
                      if (newSelected.has(notif.id)) {
                        newSelected.delete(notif.id)
                      } else {
                        newSelected.add(notif.id)
                      }
                      setSelectedIds(newSelected)
                    } else {
                      if (!notif.is_read) onMarkRead(notif.id)
                      if (notif.project_id) onNavigate(notif)
                    }
                  }}
                >
                  <div className="flex gap-3">
                    {isSelectionMode && (
                      <div className="flex-shrink-0 mt-0.5">
                        <button
                          onClick={(e) => toggleSelection(notif.id, e)}
                          className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-colors ${selectedIds.has(notif.id)
                            ? 'bg-brand-600 border-brand-600 text-white'
                            : 'border-gray-300 hover:border-gray-400'
                            }`}
                        >
                          {selectedIds.has(notif.id) && <Check className="w-2.5 h-2.5" />}
                        </button>
                      </div>
                    )}
                    <div className="flex-shrink-0 mt-0.5">
                      {getNotificationIcon(notif.type)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm ${!notif.is_read ? 'font-medium text-gray-900' : 'text-gray-700'}`}>
                        {notif.title}
                      </p>
                      {notif.message && (
                        <p className="text-xs text-gray-500 mt-0.5 truncate">{notif.message}</p>
                      )}
                      <p className="text-[10px] text-gray-400 mt-1">
                        {formatRelativeDate(notif.created_at)}
                      </p>
                    </div>
                    {!isSelectionMode && (
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            notif.is_read ? onMarkUnread(notif.id) : onMarkRead(notif.id);
                          }}
                          className="p-1 text-gray-300 hover:text-blue-500"
                          title={notif.is_read ? 'Mark as unread' : 'Mark as read'}
                        >
                          {notif.is_read ? (
                            <Mail className="w-3 h-3" />
                          ) : (
                            <CheckCircle className="w-3 h-3" />
                          )}
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); onDelete(notif.id); }}
                          className="p-1 text-gray-300 hover:text-red-500"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  )
}

// ============================================
// NOTIFICATION SETTINGS PANEL
// ============================================
function NotificationSettingsPanel({ settings, onUpdateSettings, onClose, isLoading }) {
  const [localSettings, setLocalSettings] = useState(settings || {})
  const [saving, setSaving] = useState(false)
  const saveTimeoutRef = useRef(null)

  // Check if push notifications are supported
  const isPushSupported = typeof window !== 'undefined' && (
    window.desktopBridge || ('Notification' in window)
  )
  const isElectron = typeof window !== 'undefined' && !!window.desktopBridge

  // Debounced save
  const handleToggle = (key) => {
    const newSettings = { ...localSettings, [key]: !localSettings[key] }
    setLocalSettings(newSettings)

    // Debounce the save
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current)
    saveTimeoutRef.current = setTimeout(async () => {
      setSaving(true)
      await onUpdateSettings({ [key]: newSettings[key] })
      setSaving(false)
    }, 500)
  }

  // Request browser notification permission if needed
  const requestPushPermission = async () => {
    if (!isElectron && 'Notification' in window && Notification.permission === 'default') {
      await Notification.requestPermission()
    }
  }

  // Settings configuration
  const settingsConfig = [
    {
      category: 'Reminders & Due Dates',
      icon: <Clock className="w-4 h-4 text-amber-500" />,
      items: [
        { key: 'reminder_upcoming', label: 'Upcoming reminders', description: 'When a reminder is due' },
        { key: 'reminder_overdue', label: 'Overdue items', description: 'When a task or subtask is past due' },
      ]
    },
    {
      category: 'Task Activity',
      icon: <FileText className="w-4 h-4 text-green-500" />,
      items: [
        { key: 'task_created', label: 'Task created', description: 'New tasks in shared projects' },
        { key: 'task_updated', label: 'Task updated', description: 'Task changes by collaborators' },
        { key: 'task_deleted', label: 'Task deleted', description: 'Deleted tasks in shared projects' },
        { key: 'subtask_activity', label: 'Subtask activity', description: 'Subtask changes in shared projects' },
      ]
    },
    {
      category: 'Collaboration',
      icon: <Users className="w-4 h-4 text-blue-500" />,
      items: [
        { key: 'project_shared', label: 'Project shared', description: 'When someone shares a project with you' },
        { key: 'project_removed', label: 'Removed from project', description: 'When you\'re removed from a shared project' },
        { key: 'comment_added', label: 'New comment', description: 'When someone comments on a task' },
      ]
    }
  ]

  const ToggleButton = ({ enabled, onClick, label }) => (
    <button
      onClick={onClick}
      className={`px-2 py-1 text-[10px] font-medium rounded-md transition-all ${enabled
        ? 'bg-gray-800 text-white'
        : 'bg-gray-100 text-gray-400 hover:bg-gray-200'
        }`}
      title={`${enabled ? 'Disable' : 'Enable'} ${label}`}
    >
      {label}
    </button>
  )

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-md animate-fade-in max-h-[85vh] flex flex-col shadow-2xl border border-gray-200" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200">
          <div className="flex items-center gap-2">
            <Bell className="w-5 h-5 text-gray-700" />
            <h2 className="text-lg font-bold text-gray-900">Notification Settings</h2>
          </div>
          <div className="flex items-center gap-2">
            {saving && (
              <span className="text-xs text-gray-400 flex items-center gap-1">
                <Loader2 className="w-3 h-3 animate-spin" />
                Saving...
              </span>
            )}
            <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
              <X className="w-5 h-5 text-gray-500" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          {/* Column headers */}
          <div className="flex items-center justify-end gap-2 text-[10px] font-medium text-gray-500 uppercase tracking-wider pr-1">
            <span className="w-12 text-center">In-App</span>
            <span className="w-12 text-center">Email</span>
            {isPushSupported && <span className="w-12 text-center">Push</span>}
          </div>

          {settingsConfig.map((section, sectionIdx) => (
            <div key={section.category}>
              <div className="flex items-center gap-2 mb-3">
                {section.icon}
                <h4 className="text-sm font-semibold text-gray-700">{section.category}</h4>
              </div>
              <div className="space-y-2">
                {section.items.map(item => (
                  <div key={item.key} className="flex items-center justify-between py-2 px-3 bg-gray-50 rounded-lg">
                    <div className="flex-1 min-w-0 mr-3">
                      <p className="text-sm text-gray-800 font-medium">{item.label}</p>
                      <p className="text-[11px] text-gray-500 truncate">{item.description}</p>
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <ToggleButton
                        enabled={localSettings[`${item.key}_inapp`] ?? false}
                        onClick={() => handleToggle(`${item.key}_inapp`)}
                        label="In-App"
                      />
                      <ToggleButton
                        enabled={localSettings[`${item.key}_email`] ?? false}
                        onClick={() => handleToggle(`${item.key}_email`)}
                        label="Email"
                      />
                      {isPushSupported && (
                        <ToggleButton
                          enabled={localSettings[`${item.key}_push`] ?? false}
                          onClick={() => {
                            requestPushPermission()
                            handleToggle(`${item.key}_push`)
                          }}
                          label="Push"
                        />
                      )}
                    </div>
                  </div>
                ))}
              </div>
              {sectionIdx < settingsConfig.length - 1 && <div className="border-b border-gray-100 mt-4" />}
            </div>
          ))}

          {/* Info footer */}
          <div className="text-xs text-gray-400 pt-4 border-t border-gray-100 space-y-1">
            <p className="flex items-center gap-1">
              <Bell className="w-3 h-3" />
              <span><strong>In-App:</strong> Shows in the notification bell</span>
            </p>
            <p className="flex items-center gap-1">
              <Mail className="w-3 h-3" />
              <span><strong>Email:</strong> Sent to your email address</span>
            </p>
            {isPushSupported && (
              <p className="flex items-center gap-1">
                <Smartphone className="w-3 h-3" />
                <span><strong>Push:</strong> {isElectron ? 'Desktop notifications' : 'Browser notifications'}</span>
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ============================================
// REMINDER DATE PICKER
// ============================================
function ReminderPicker({ value, onChange, compact = false, isShared = false, defaultScope = 'all' }) {
  // onChange may accept (date) or (date, scope)
  // scope: 'all' (notify collaborators) | 'me' (only me)
  // To enable collaborator notifications, callers should pass `isShared` and handle scope in their update handlers.
  // Backwards compatible: if caller expects only date, we'll call with single arg.
  const [isOpen, setIsOpen] = useState(false)
  const [pendingValue, setPendingValue] = useState('')
  const [scope, setScope] = useState(defaultScope)
  const buttonRef = useRef(null)
  const hasReminder = !!value
  const overdue = isOverdue(value)

  // Initialize pending value when opening or when value changes
  useEffect(() => {
    if (isOpen) {
      setPendingValue(formatDateForInput(value) || formatDateForInput(new Date().toISOString()))
    }
  }, [isOpen, value])

  // Get the user's timezone for display
  const userTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone

  // Quick set helper - uses local time correctly
  const handleQuickSet = (hours) => {
    const now = new Date()
    const futureDate = new Date(now.getTime() + hours * 60 * 60 * 1000)
    // default to notify all unless caller expects scope handling
    if (onChange.length >= 2) {
      onChange(futureDate.toISOString(), defaultScope)
    } else {
      onChange(futureDate.toISOString())
    }
    setIsOpen(false)
  }

  // Confirm the pending value
  const handleConfirm = () => {
    if (pendingValue) {
      // Parse the local datetime string and convert to ISO
      const localDate = new Date(pendingValue)
      if (onChange.length >= 2) {
        onChange(localDate.toISOString(), scope)
      } else {
        onChange(localDate.toISOString())
      }
    }
    setIsOpen(false)
  }

  // Format time for preview display
  const formatPreviewTime = (dateString) => {
    if (!dateString) return ''
    const date = new Date(dateString)
    return date.toLocaleString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    })
  }

  const mounted = useMounted()

  return (
    <div className="relative" ref={buttonRef}>
      <button
        onClick={(e) => { e.stopPropagation(); setIsOpen(!isOpen); }}
        className={`flex items-center gap-1 px-2 py-1 rounded-lg text-xs transition-colors ${overdue
          ? 'bg-red-100 text-red-600 hover:bg-red-200'
          : hasReminder
            ? 'bg-amber-100 text-amber-600 hover:bg-amber-200'
            : 'text-gray-400 hover:bg-gray-100 hover:text-gray-600'
          }`}
        title={hasReminder ? `Reminder: ${new Date(value).toLocaleString()}` : 'Set reminder'}
      >
        {overdue ? <AlertCircle className="w-3 h-3" /> : <Calendar className="w-3 h-3" />}
        {!compact && (
          <span>{hasReminder ? formatReminderDate(value) : 'Remind'}</span>
        )}
      </button>
      {mounted && isOpen && typeof document !== 'undefined' && createPortal(
        <>
          <div className="fixed inset-0 z-[9998]" onClick={() => setIsOpen(false)} />
          <div
            style={{
              position: 'fixed',
              zIndex: 9999,
              top: buttonRef.current ? buttonRef.current.getBoundingClientRect().bottom + 8 : 100,
              left: buttonRef.current ? Math.max(8, Math.min(
                buttonRef.current.getBoundingClientRect().left,
                window.innerWidth - 292
              )) : 8,
              maxHeight: 'calc(100vh - 40px)',
              overflowY: 'auto'
            }}
            className="w-72 bg-white rounded-xl shadow-2xl border border-gray-200 p-4 animate-fade-in"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <label className="text-sm font-medium text-gray-800">Set Reminder</label>
              <span className="text-[10px] text-gray-400">{userTimezone}</span>
            </div>

            <input
              type="datetime-local"
              value={pendingValue}
              onChange={(e) => setPendingValue(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && e.shiftKey) {
                  onConfirm(pendingValue)
                }
                if (e.key === 'Escape') setIsOpen(false)
              }}
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-400 focus:border-transparent"
            />

            {/* Preview of selected time */}
            {pendingValue && (
              <div className="mt-2 px-2 py-1.5 bg-blue-50 rounded-lg">
                <p className="text-xs text-blue-700 font-medium">
                  {formatPreviewTime(pendingValue)}
                </p>
              </div>
            )}

            {/* Action buttons */}
            {isShared && (
              <div className="mt-2 flex items-center gap-2 text-xs">
                <span className="text-gray-500">Notify</span>
                <div className="inline-flex rounded-lg bg-gray-100 p-1">
                  <button
                    onClick={() => setScope('all')}
                    className={`px-2 py-1 rounded-md ${scope === 'all' ? 'bg-white shadow text-gray-900' : 'text-gray-600'}`}
                  >
                    All
                  </button>
                  <button
                    onClick={() => setScope('me')}
                    className={`px-2 py-1 rounded-md ${scope === 'me' ? 'bg-white shadow text-gray-900' : 'text-gray-600'}`}
                  >
                    Only me
                  </button>
                </div>
              </div>
            )}
            <div className="mt-3 flex gap-2">
              <button
                onClick={handleConfirm}
                disabled={!pendingValue}
                className="flex-1 px-3 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Done
              </button>
              <button
                onClick={() => setIsOpen(false)}
                className="px-3 py-2 text-gray-600 text-sm hover:bg-gray-100 rounded-lg transition-colors"
              >
                Cancel
              </button>
            </div>

            {hasReminder && (
              <button
                onClick={() => { onChange(null); setIsOpen(false); }}
                className="mt-2 w-full px-3 py-1.5 text-xs text-red-600 hover:bg-red-50 rounded-lg transition-colors"
              >
                Remove reminder
              </button>
            )}

            <div className="mt-3 pt-3 border-t border-gray-100">
              <p className="text-[10px] text-gray-400 mb-2">Quick set:</p>
              <div className="flex flex-wrap gap-1.5">
                {[
                  { label: '1h', hours: 1 },
                  { label: '3h', hours: 3 },
                  { label: 'Tomorrow', hours: 24 },
                  { label: '1 week', hours: 168 }
                ].map(opt => (
                  <button
                    key={opt.label}
                    onClick={() => handleQuickSet(opt.hours)}
                    className="px-3 py-1.5 text-xs bg-gray-100 hover:bg-gray-200 rounded-lg text-gray-700 font-medium transition-colors"
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </>,
        document.body
      )}
    </div>
  )
}

// ============================================
// PROFILE SETTINGS MODAL
// ============================================
function ProfileSettingsModal({ onClose }) {
  const { user, updateProfile, updateEmail, updatePassword, isEmailAuth, demoMode } = useAuth()
  const avatarInputRef = React.useRef(null)
  const [avatarUploading, setAvatarUploading] = useState(false)

  const handleAvatarFile = async (file) => {
    if (!file) return
    const maxBytes = 2 * 1024 * 1024
    if (!file.type.startsWith('image/')) {
      setMessage({ type: 'error', text: 'Please upload an image (png/jpg).' })
      return
    }
    if (file.size > maxBytes) {
      setMessage({ type: 'error', text: 'Image too large; use under 2MB.' })
      return
    }
    setAvatarUploading(true)
    try {
      const reader = new FileReader()
      reader.onload = async (e) => {
        const dataUrl = e.target.result
        const { error } = await updateProfile({ avatar_url: dataUrl })
        if (error) setMessage({ type: 'error', text: error.message })
        else setMessage({ type: 'success', text: 'Avatar updated' })
        setAvatarUploading(false)
      }
      reader.readAsDataURL(file)
    } catch (e) {
      setMessage({ type: 'error', text: 'Upload failed' })
      setAvatarUploading(false)
    }
  }
  const [activeTab, setActiveTab] = useState('profile')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState({ type: '', text: '' })

  // Profile state
  const [name, setName] = useState(user?.user_metadata?.full_name || user?.user_metadata?.name || '')

  // Email state
  const [newEmail, setNewEmail] = useState('')

  // Password state
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')

  const showEmailAuth = isEmailAuth()

  const handleUpdateProfile = async (e) => {
    e.preventDefault()
    setLoading(true)
    setMessage({ type: '', text: '' })

    const { error } = await updateProfile({
      full_name: name,
      name
    })

    if (error) {
      setMessage({ type: 'error', text: error.message })
    } else {
      setMessage({ type: 'success', text: 'Profile updated successfully!' })
    }
    setLoading(false)
  }

  const handleUpdateEmail = async (e) => {
    e.preventDefault()
    setLoading(true)
    setMessage({ type: '', text: '' })

    if (!newEmail.trim()) {
      setMessage({ type: 'error', text: 'Please enter a new email address' })
      setLoading(false)
      return
    }

    const { error } = await updateEmail(newEmail)

    if (error) {
      setMessage({ type: 'error', text: error.message })
    } else {
      setMessage({ type: 'success', text: 'Confirmation email sent to your new address. Please check your inbox.' })
      setNewEmail('')
    }
    setLoading(false)
  }

  const handleUpdatePassword = async (e) => {
    e.preventDefault()
    setLoading(true)
    setMessage({ type: '', text: '' })

    if (newPassword.length < 6) {
      setMessage({ type: 'error', text: 'Password must be at least 6 characters' })
      setLoading(false)
      return
    }

    if (newPassword !== confirmPassword) {
      setMessage({ type: 'error', text: 'Passwords do not match' })
      setLoading(false)
      return
    }

    const { error } = await updatePassword(newPassword)

    if (error) {
      setMessage({ type: 'error', text: error.message })
    } else {
      setMessage({ type: 'success', text: 'Password updated successfully!' })
      setNewPassword('')
      setConfirmPassword('')
    }
    setLoading(false)
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-md animate-fade-in shadow-2xl border border-gray-200" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200">
          <h2 className="text-lg font-bold text-gray-900">Account Settings</h2>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-200">
          <button
            onClick={() => { setActiveTab('profile'); setMessage({ type: '', text: '' }) }}
            className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${activeTab === 'profile'
              ? 'text-gray-900 border-b-2 border-gray-900'
              : 'text-gray-500 hover:text-gray-700'
              }`}
          >
            Profile
          </button>
          {showEmailAuth && (
            <>
              <button
                onClick={() => { setActiveTab('email'); setMessage({ type: '', text: '' }) }}
                className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${activeTab === 'email'
                  ? 'text-gray-900 border-b-2 border-gray-900'
                  : 'text-gray-500 hover:text-gray-700'
                  }`}
              >
                Email
              </button>
              <button
                onClick={() => { setActiveTab('password'); setMessage({ type: '', text: '' }) }}
                className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${activeTab === 'password'
                  ? 'text-gray-900 border-b-2 border-gray-900'
                  : 'text-gray-500 hover:text-gray-700'
                  }`}
              >
                Password
              </button>
            </>
          )}
        </div>

        {/* Content */}
        <div className="p-4">
          {message.text && (
            <div className={`mb-4 p-3 rounded-lg text-sm ${message.type === 'error' ? 'bg-red-50 text-red-600' : 'bg-green-50 text-green-600'
              }`}>
              {message.text}
            </div>
          )}

          {/* Profile Tab */}
          {activeTab === 'profile' && (
            <form onSubmit={handleUpdateProfile}>
              <div className="mb-4 flex items-center gap-4">
                <div>
                  <Avatar size={64} />
                </div>
                <div className="flex flex-col gap-2">
                  <label className="text-sm text-gray-700">Profile Image</label>
                  <div className="flex items-center gap-2">
                    <input ref={avatarInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => handleAvatarFile(e.target.files?.[0])} />
                    <button type="button" onClick={() => avatarInputRef.current?.click()} className="px-3 py-1.5 text-sm rounded bg-gray-100 hover:bg-gray-200">Upload avatar</button>
                    {avatarUploading && <span className="text-xs text-gray-500">Uploading…</span>}
                  </div>
                </div>
              </div>
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">Display Name</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && e.shiftKey) { e.preventDefault(); handleUpdateProfile(e); } }}
                  placeholder="Your name"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-400 focus:border-transparent"
                />
              </div>
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                <input
                  type="email"
                  value={user?.email || ''}
                  disabled
                  className="w-full px-4 py-2 border border-gray-200 rounded-lg bg-gray-50 text-gray-500"
                />
                <p className="text-xs text-gray-400 mt-1">
                  {showEmailAuth ? 'Change email in the Email tab' : 'Managed by Google'}
                </p>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-gray-800 text-white rounded-lg font-medium hover:bg-gray-700 transition-colors disabled:opacity-50"
              >
                {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                Save Changes
              </button>
            </form>
          )}

          {/* Email Tab */}
          {activeTab === 'email' && showEmailAuth && (
            <form onSubmit={handleUpdateEmail}>
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">Current Email</label>
                <input
                  type="email"
                  value={user?.email || ''}
                  disabled
                  className="w-full px-4 py-2 border border-gray-200 rounded-lg bg-gray-50 text-gray-500"
                />
              </div>
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">New Email</label>
                <input
                  type="email"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  placeholder="newemail@example.com"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-400 focus:border-transparent"
                />
                <p className="text-xs text-gray-400 mt-1">A confirmation link will be sent to your new email</p>
              </div>
              <button
                type="submit"
                disabled={loading || demoMode}
                className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-gray-800 text-white rounded-lg font-medium hover:bg-gray-700 transition-colors disabled:opacity-50"
              >
                {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                Update Email
              </button>
            </form>
          )}

          {/* Password Tab */}
          {activeTab === 'password' && showEmailAuth && (
            <form onSubmit={handleUpdatePassword}>
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">New Password</label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="••••••••"
                  minLength={6}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-400 focus:border-transparent"
                />
              </div>
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">Confirm New Password</label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="••••••••"
                  minLength={6}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-400 focus:border-transparent"
                />
              </div>
              <button
                type="submit"
                disabled={loading || demoMode}
                className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-gray-800 text-white rounded-lg font-medium hover:bg-gray-700 transition-colors disabled:opacity-50"
              >
                {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                Update Password
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}

// ============================================
// HEADER
// ============================================
function Header({ projects, onSearchNavigate, notifications, onMarkNotificationRead, onMarkNotificationUnread, onMarkAllNotificationsRead, onDeleteNotification, onDeleteMultipleNotifications, onClearAllNotifications, onNotificationNavigate, onLogoClick, notificationSettings, onUpdateNotificationSettings }) {
  const { user, signOut, demoMode, isEmailAuth } = useAuth()
  const [showMenu, setShowMenu] = useState(false)
  const [menuAnchor, setMenuAnchor] = useState(null)
  const [showSettings, setShowSettings] = useState(false)
  const [showNotifications, setShowNotifications] = useState(false)
  const [notifAnchor, setNotifAnchor] = useState(null)
  const [showNotificationSettings, setShowNotificationSettings] = useState(false)
  const mounted = useMounted()

  const userName = user?.user_metadata?.full_name || user?.user_metadata?.name || user?.email?.split('@')[0] || 'User'
  const avatarUrl = user?.user_metadata?.avatar_url || user?.user_metadata?.picture
  const unreadCount = notifications?.filter(n => !n.is_read).length || 0

  return (
    <>
      <header className="bg-white/80 backdrop-blur-lg border-b border-gray-200 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16 gap-2 sm:gap-4">
            <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
              <div id="app-logo" onClick={(e) => { e.stopPropagation(); if (onLogoClick) onLogoClick() }} className="cursor-pointer flex items-center gap-2">
                <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl flex items-center justify-center text-base sm:text-lg" style={{ background: 'linear-gradient(135deg, #e5e7eb, #4b5563)' }}>
                  🔬
                </div>
                <span className="font-bold text-lg sm:text-xl text-gray-900 hidden sm:block">HypotheSys™</span>
              </div>
              {demoMode && (
                <span className="tag tag-warning text-[10px] hidden sm:inline-flex">DEMO</span>
              )}
            </div>

            {/* Global Search */}
            <GlobalSearch projects={projects} onNavigate={onSearchNavigate} />

            <div className="flex items-center gap-1 sm:gap-2 flex-shrink-0">
              {/* Notifications Bell */}
              <div className="relative">
                <button
                  onClick={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    setNotifAnchor(rect);
                    setShowNotifications(!showNotifications);
                    setShowNotificationSettings(false);
                  }}
                  className="p-2 rounded-xl hover:bg-gray-100 transition-colors relative"
                >
                  <Bell className="w-5 h-5 text-gray-500" />
                  {unreadCount > 0 && (
                    <span className="absolute top-1 right-1 w-4 h-4 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
                      {unreadCount > 9 ? '9+' : unreadCount}
                    </span>
                  )}
                </button>

              </div>

              {/* Sync Button (Desktop Only) */}
              {typeof window !== 'undefined' && window.desktopBridge && (
                <button
                  onClick={() => window.location.reload()}
                  className="p-2 rounded-xl hover:bg-gray-100 transition-colors relative"
                  title="Sync (Reload)"
                >
                  <RefreshCw className="w-5 h-5 text-gray-500" />
                </button>
              )}

              {/* User Menu */}
              <div className="relative">
                <button
                  onClick={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    setMenuAnchor(rect);
                    setShowMenu(!showMenu);
                  }}
                  className="flex items-center gap-2 sm:gap-3 p-2 rounded-xl hover:bg-gray-100 transition-colors"
                >
                  <Avatar size={32} />
                  <span className="font-medium text-gray-700 hidden md:block">{userName}</span>
                </button>

                {mounted && showMenu && menuAnchor && typeof document !== 'undefined' && createPortal(
                  <>
                    <div className="fixed inset-0 z-[100]" onClick={() => { setShowMenu(false); setMenuAnchor(null); }} />
                    <div
                      style={{
                        position: 'fixed',
                        top: menuAnchor.bottom + 8,
                        right: typeof window !== 'undefined' ? window.innerWidth - menuAnchor.right : 0,
                        zIndex: 101
                      }}
                      className="w-56 glass-card rounded-xl shadow-lg py-2 animate-fade-in"
                      onClick={e => e.stopPropagation()}
                    >
                      <div className="px-4 py-2 border-b border-gray-100">
                        <p className="text-sm font-medium text-gray-900">{userName}</p>
                        <p className="text-xs text-gray-500 truncate">{user?.email}</p>
                        {!isEmailAuth() && (
                          <p className="text-xs text-gray-400 mt-1 flex items-center gap-1">
                            <svg className="w-3 h-3" viewBox="0 0 24 24">
                              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                            </svg>
                            Signed in with Google
                          </p>
                        )}
                      </div>
                      <button
                        onClick={() => { setShowMenu(false); setMenuAnchor(null); setShowSettings(true); }}
                        className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"
                      >
                        <Settings className="w-4 h-4" />
                        Account Settings
                      </button>
                      <button
                        onClick={signOut}
                        className="w-full px-4 py-2 text-left text-sm text-red-600 hover:bg-red-50 flex items-center gap-2"
                      >
                        <LogOut className="w-4 h-4" />
                        Sign out
                      </button>
                    </div>
                  </>,
                  document.body
                )}
              </div>
            </div>
          </div>
        </div>
      </header>

      {showSettings && <ProfileSettingsModal onClose={() => setShowSettings(false)} />}
      {showNotificationSettings && (
        <NotificationSettingsPanel
          settings={notificationSettings}
          onUpdateSettings={onUpdateNotificationSettings}
          onClose={() => setShowNotificationSettings(false)}
        />
      )}
      {showNotifications && !showNotificationSettings && (
        <NotificationPane
          notifications={notifications || []}
          onMarkRead={onMarkNotificationRead}
          onMarkUnread={onMarkNotificationUnread}
          onMarkAllRead={onMarkAllNotificationsRead}
          onDelete={onDeleteNotification}
          onDeleteMultiple={onDeleteMultipleNotifications}
          onClear={onClearAllNotifications}
          onNavigate={(notif) => {
            setShowNotifications(false)
            setNotifAnchor(null)
            onNotificationNavigate(notif)
          }}
          onClose={() => { setShowNotifications(false); setNotifAnchor(null); }}
          onOpenSettings={() => setShowNotificationSettings(true)}
          position={notifAnchor ? {
            top: notifAnchor.bottom + 8,
            right: typeof window !== 'undefined' ? window.innerWidth - notifAnchor.right : 0
          } : null}
        />
      )}
    </>
  )
}

// ============================================
// TAB NAVIGATION
// ============================================
function TabNav({ tab, setTab }) {
  return (
    <div className="bg-white/60 backdrop-blur-sm border-b border-gray-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <nav className="flex gap-1">
          {[
            { id: 'projects', label: 'Projects', icon: '◫' },
            { id: 'tasks', label: 'Tasks', icon: '✓' },
            { id: 'today', label: 'Tod(o)ay', icon: '☀' }
          ].map(t => (
            <button
              id={`tab-${t.id}`}
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-5 py-4 font-medium text-sm border-b-2 transition-colors ${tab === t.id
                ? 'border-brand-600 text-brand-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
            >
              <span className="mr-2">
                {t.id === 'today' ? (
                  <svg className="w-4 h-4 inline-block" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
                    <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.5" />
                    <path d="M12 2v2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                    <path d="M12 20v2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                    <path d="M4.93 4.93l1.41 1.41" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                    <path d="M17.66 17.66l1.41 1.41" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                    <path d="M2 12h2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                    <path d="M20 12h2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                    <path d="M4.93 19.07l1.41-1.41" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                    <path d="M17.66 6.34l1.41-1.41" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                ) : t.icon}
              </span>
              {t.label}
            </button>
          ))}
        </nav>
      </div>
    </div>
  )
}

// ============================================
// PROJECTS VIEW
// ============================================
// Optimized Today Item Component
const TodayItem = React.memo(({
  item,
  project,
  index,
  isSelectionMode,
  isSelected,
  isMenuOpen,
  isEditing,
  onToggleSelect,
  onToggleDone,
  onMenuToggle,
  onEditStart,
  onEditCancel,
  onRename,
  onDelete,
  onDuplicate,
  onSetReminder,
  onDragStart,
  onDragOver,
  onDrop
}) => {
  const [editText, setEditText] = useState(item.title || '')
  const lastTapRef = useRef(0)

  // Sync local edit text when item changes or editing starts
  useEffect(() => {
    if (isEditing) setEditText(item.title || '')
  }, [isEditing, item.title])

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      const trimmed = editText.trim()
      if (trimmed) onRename(item, trimmed)
    } else if (e.key === 'Escape') {
      onEditCancel()
    }
  }

  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, index)}
      onDragOver={(e) => onDragOver(e, index)}
      onDrop={(e) => onDrop(e, index)}
      className={`glass-card p-2 rounded-lg flex items-center justify-between ${item.is_done ? 'opacity-60' : ''} ${isMenuOpen ? 'z-20 relative' : 'z-0'}`}
      style={{ transition: 'opacity 0.2s, transform 0.2s' }}
    >
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-shrink-0">
          {isSelectionMode && (
            <button
              onClick={(e) => { e.stopPropagation(); onToggleSelect(item.id) }}
              className={`w-5 h-5 rounded border flex items-center justify-center transition-colors ${isSelected ? 'bg-brand-600 border-brand-600 text-white' : 'border-gray-300 bg-white'}`}
            >
              {isSelected && <Check className="w-3 h-3" />}
            </button>
          )}
          <button
            onClick={async () => await onToggleDone(item.id)}
            className={`w-5 h-5 rounded border flex items-center justify-center transition-colors ${item.is_done ? 'bg-brand-600 border-brand-600 text-white' : 'border-gray-300 bg-white'}`}
          >
            {item.is_done ? <Check className="w-3 h-3" /> : null}
          </button>
          <button
            type="button"
            title="Edit"
            onClick={() => onEditStart(item.id)}
            className="text-gray-500 hover:text-gray-800 px-2 py-1 rounded hover:bg-gray-100 transition-colors"
          >
            <FileText className="w-4 h-4" />
          </button>
        </div>

        <div className="min-w-0 flex-1">
          {isEditing ? (
            <div className="flex gap-2 items-center">
              <input
                autoFocus
                className="input-sleek py-1 px-2 text-sm h-8"
                value={editText}
                onChange={e => setEditText(e.target.value)}
                onKeyDown={handleKeyDown}
                onClick={e => e.stopPropagation()}
              />
              <button
                type="button"
                onClick={async (e) => { e.stopPropagation(); if (editText.trim()) await onRename(item, editText.trim()) }}
                className="px-2 py-1 bg-gray-800 text-white rounded text-xs h-8 hover:bg-gray-700"
              >
                Save
              </button>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onEditCancel() }}
                className="px-2 py-1 bg-gray-100 rounded text-xs h-8 hover:bg-gray-200"
              >
                Cancel
              </button>
            </div>
          ) : (
            <div
              className="group cursor-pointer"
              onDoubleClick={() => onEditStart(item.id)}
              onTouchEnd={() => {
                const now = Date.now()
                if (now - lastTapRef.current < 350) {
                  onEditStart(item.id)
                  lastTapRef.current = 0
                } else {
                  lastTapRef.current = now
                }
              }}
            >
              <div className={`font-medium text-gray-900 truncate ${item.is_done ? 'line-through text-gray-400' : ''}`}>
                {item.title}
              </div>
              {project && (
                <div className="text-xs text-gray-400 truncate flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 inline-block"></span>
                  {project.title}
                </div>
              )}
              {item.reminder_date && (
                <div className={`text-[10px] flex items-center gap-1 mt-0.5 ${isOverdue(item.reminder_date) && !item.is_done ? 'text-red-600' : 'text-amber-600'}`}>
                  <Clock className="w-3 h-3" />
                  {formatReminderDate(item.reminder_date)}
                </div>
              )}
              {/* Tags Display in TodayItem */}
              {item.tags?.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {item.tags.map(tag => {
                    const colorMap = {
                      blue: 'bg-blue-100 text-blue-700',
                      green: 'bg-green-100 text-green-700',
                      red: 'bg-red-100 text-red-700',
                      amber: 'bg-amber-100 text-amber-700',
                      purple: 'bg-purple-100 text-purple-700',
                      pink: 'bg-pink-100 text-pink-700',
                      indigo: 'bg-indigo-100 text-indigo-700',
                      gray: 'bg-gray-100 text-gray-700'
                    }
                    const colorClasses = colorMap[tag.color] || colorMap.blue
                    return (
                      <span key={tag.id} className={`px-1.5 py-0.5 rounded text-[9px] font-medium ${colorClasses}`}>
                        {tag.name}
                      </span>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 relative flex-shrink-0 ml-2">
        {/* Quick Reminder Picker */}
        <ReminderPicker
          value={item.reminder_date || null}
          compact={true}
          onChange={(newDate) => {
            onSetReminder(item.id, newDate)
          }}
        />

        <button
          onClick={(e) => { e.stopPropagation(); onMenuToggle(item.id) }}
          className={`p-1.5 rounded-lg transition-colors ${isMenuOpen ? 'bg-gray-100 text-gray-800' : 'text-gray-400 hover:bg-gray-50 hover:text-gray-600'}`}
        >
          <MoreVertical className="w-4 h-4" />
        </button>
        {isMenuOpen && (
          <>
            <div className="fixed inset-0 z-30 cursor-default" onClick={(e) => { e.stopPropagation(); onMenuToggle(null); }} />
            <div className="absolute right-0 top-full mt-1 bg-white border border-gray-100 shadow-xl rounded-xl z-40 py-1 w-36 animate-fade-in flex flex-col overflow-hidden">
              <button
                onClick={(e) => { e.stopPropagation(); onDuplicate([item.id]); onMenuToggle(null); }}
                className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-3 transition-colors"
              >
                <Copy className="w-4 h-4 text-gray-400" /> Duplicate
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); onDelete([item.id]); onMenuToggle(null); }}
                className="w-full text-left px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 flex items-center gap-3 transition-colors"
              >
                <Trash2 className="w-4 h-4" /> Delete
              </button>
            </div>
          </>
        )}
      </div>
    </div >
  )
})

function TodayView() {
  const { todayItems, addLocalTodayTask, addToToday, addSubtaskToToday, removeTodayItem, removeTodayItems, duplicateTodayItems, reorderToday, projects, toggleTodayDone, setSelectedTask, setSelectedProject, setView, setTodayItems, saveTodayItems, showToast, user, demoMode, reloadProjects, setProjects } = useApp()
  const mounted = useMounted()
  const [newTitle, setNewTitle] = useState('')
  const [existingPicker, setExistingPicker] = useState(null) // { position }
  const [existingQuery, setExistingQuery] = useState('')
  const [todaySearch, setTodaySearch] = useState('')
  const pickerRef = useRef(null)
  const [isSelectionMode, setIsSelectionMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [editingId, setEditingId] = useState(null)
  const [editText, setEditText] = useState('')
  const lastTapRef = useRef(0)
  const [openMenuId, setOpenMenuId] = useState(null)
  const [todaySubtab, setTodaySubtab] = useState('active') // 'active', 'completed', 'all'

  const itemsToShow = useMemo(() => {
    if (todaySubtab === 'active') return todayItems.filter(i => !i.is_done)
    if (todaySubtab === 'completed') return todayItems.filter(i => i.is_done)
    if (todaySubtab === 'scheduled') return todayItems.filter(i => i.reminder_date && !i.is_done)
    return todayItems
  }, [todayItems, todaySubtab])

  const todaySearchQuery = todaySearch.trim().toLowerCase()
  const filteredTodayItems = useMemo(() => {
    if (!todaySearchQuery) return itemsToShow
    return itemsToShow.filter(i => i.title?.toLowerCase().includes(todaySearchQuery) || (i.tags || []).some(t => t.name?.toLowerCase().includes(todaySearchQuery)))
  }, [itemsToShow, todaySearchQuery])

  const displayedTodayItems = useMemo(() => {
    if (todaySubtab !== 'completed') return filteredTodayItems
    const sorted = [...filteredTodayItems].sort((a, b) => {
      const aTime = new Date(a.completed_at || a.updated_at || a.created_at || 0).getTime()
      const bTime = new Date(b.completed_at || b.updated_at || b.created_at || 0).getTime()
      return bTime - aTime
    })
    return sorted
  }, [filteredTodayItems, todaySubtab])

  // Set reminder on a today item
  const setTodayItemReminder = async (itemId, reminderDate) => {
    const next = todayItems.map(x => x.id === itemId ? { ...x, reminder_date: reminderDate } : x)
    setTodayItems(next)
    await saveTodayItems(next)
  }

  const onRenameItem = async (it, trimmed) => {
    if (!trimmed) return

    // Local item: update locally
    if (it.isLocal) {
      const next = todayItems.map(x => x.id === it.id ? { ...x, title: trimmed } : x)
      setTodayItems(next)
      await saveTodayItems(next)
      setEditingId(null)
      return
    }

    // Linked item: attempt server update, fall back to demo-mode local update
    try {
      if (!demoMode && db && (it.taskId || it.subtaskId)) {
        if (it.subtaskId) {
          const { data, error } = await db.updateSubtask(it.subtaskId, { title: trimmed, modified_by: user?.id })
          if (error) { showToast('Failed to update subtask: ' + (error.message || error)); return }
        } else if (it.taskId) {
          const { data, error } = await db.updateTask(it.taskId, { title: trimmed, modified_by: user?.id })
          if (error) { showToast('Failed to update task: ' + (error.message || error)); return }
        }
        // refresh local projects to reflect updated title
        try { await reloadProjects() } catch (e) { }
      } else {
        // demo mode: update in-memory projects
        let updated = false
        const newProjects = projects.map(p => ({
          ...p, stages: (p.stages || []).map(s => ({
            ...s, tasks: (s.tasks || []).map(t => {
              if (it.subtaskId) {
                const newSubtasks = (t.subtasks || []).map(st => st.id === it.subtaskId ? { ...st, title: trimmed } : st)
                if (newSubtasks.some((ns, idx) => ns !== (t.subtasks || [])[idx])) updated = true
                return { ...t, subtasks: newSubtasks }
              }
              if (it.taskId && t.id === it.taskId) {
                updated = true
                return { ...t, title: trimmed }
              }
              return t
            })
          }))
        }))
        if (updated) setProjects(newProjects)
      }

      // Update today list to reflect new title
      const next = todayItems.map(x => x.id === it.id ? { ...x, title: trimmed } : x)
      setTodayItems(next)
      await saveTodayItems(next)
      setEditingId(null)
    } catch (e) {
      dwarn('Failed to save renamed item', e)
      showToast('Failed to save change')
    }
  }
  // Flatten tasks and subtasks with project context for the existing-task picker
  const allEntries = useMemo(() => projects.flatMap(p => (p.stages || []).flatMap((s, si) => (s.tasks || []).flatMap(t => {
    // Only include non-completed tasks
    const base = !t.is_completed ? [{ type: 'task', task: t, project: p, stage: s, stageIndex: si }] : []
    // Only include non-completed subtasks
    const subs = (t.subtasks || []).filter(st => !st.is_completed).map(st => ({ type: 'subtask', subtask: st, task: t, project: p, stage: s, stageIndex: si }))
    return [...base, ...subs]
  }))), [projects])

  useEffect(() => {
    if (!existingPicker) return
    const onDocDown = (e) => {
      if (!pickerRef.current) return
      if (!pickerRef.current.contains(e.target)) setExistingPicker(null)
    }
    const onKey = (e) => { if (e.key === 'Escape') setExistingPicker(null) }
    document.addEventListener('mousedown', onDocDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [existingPicker])
  // Drag handlers
  const dragIndex = useRef(null)

  const onDragStart = (e, i) => { dragIndex.current = i; e.dataTransfer?.setData('text/plain', String(i)) }
  const onDragOver = (e, i) => { e.preventDefault() }
  const onDrop = (e, i) => {
    e.preventDefault()
    const from = dragIndex.current != null ? dragIndex.current : parseInt(e.dataTransfer?.getData('text/plain') || '0', 10)
    const to = i
    if (from !== to) reorderToday(from, to)
    dragIndex.current = null
  }

  const handleToggleDone = async (id) => {
    const item = todayItems.find(i => i.id === id)
    const wasDone = !!item?.is_done
    await toggleTodayDone(id)
    if (wasDone) setTodaySubtab('active')
  }

  return (
    <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-6 sm:py-8">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-bold">Tod(o)ay checklist</h2>
          <p className="text-sm text-gray-500">Your ToDo checklist to conquer the day! </p>
        </div>
        <div className="flex items-center gap-2 relative flex-wrap sm:flex-nowrap">
          {/* Selection mode toggle / actions (moved left of input) */}
          {!isSelectionMode ? (
            <button
              onClick={() => { setIsSelectionMode(true); setSelectedIds(new Set()) }}
              title="Select items"
              className="text-xs sm:text-sm px-3 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 flex items-center gap-2"
            >
              <Check className="w-4 h-4 text-gray-700" />
              <span className="text-gray-700">Select</span>
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <button onClick={() => {
                const visibleIds = itemsToShow.map(i => i.id)
                if (selectedIds.size === visibleIds.length && visibleIds.every(id => selectedIds.has(id))) {
                  setSelectedIds(new Set())
                } else {
                  setSelectedIds(new Set(visibleIds))
                }
              }} className="text-xs sm:text-sm px-3 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200">
                {selectedIds.size === itemsToShow.length && itemsToShow.length > 0 ? 'Deselect All' : 'Select All'}
              </button>
              <button onClick={async () => {
                const toRemove = Array.from(selectedIds)
                if (toRemove.length === 0) return
                try { await removeTodayItems(toRemove) } catch (e) { dwarn('removeTodayItems failed', e) }
                setSelectedIds(new Set())
                setIsSelectionMode(false)
              }} className="text-xs sm:text-sm px-3 py-1.5 rounded-lg bg-red-100 text-red-600 hover:bg-red-200 flex items-center gap-1"><Trash2 className="w-4 h-4" /> <span>Delete</span> <span className="opacity-80">({selectedIds.size})</span></button>
              <button onClick={async () => {
                const toDup = Array.from(selectedIds)
                if (toDup.length === 0) return
                try { await duplicateTodayItems(toDup) } catch (e) { dwarn('duplicateTodayItems failed', e) }
                setSelectedIds(new Set())
                setIsSelectionMode(false)
              }} className="text-xs sm:text-sm px-3 py-1.5 rounded-lg bg-gray-800 text-white hover:bg-gray-700 flex items-center gap-1"><Copy className="w-4 h-4" /> <span>Duplicate</span> <span className="opacity-80">({selectedIds.size})</span></button>
              <button onClick={() => { setIsSelectionMode(false); setSelectedIds(new Set()) }} className="text-xs sm:text-sm px-3 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200">Cancel</button>
            </div>
          )}

          <input
            value={newTitle}
            onChange={e => setNewTitle(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                addLocalTodayTask(newTitle);
                setNewTitle('')
              }
            }}
            placeholder="+ New task for today"
            className="input-sleek flex-1 min-w-[12rem] sm:min-w-[20rem] lg:min-w-[24rem]"
          />
          <button
            id="today-add-existing"
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              setExistingPicker(existingPicker ? null : {
                position: {
                  top: rect.bottom + window.scrollY + 8,
                  right: window.innerWidth - rect.right
                }
              });
              setExistingQuery('');
            }}
            className="px-3 py-2 bg-white border border-gray-200 rounded text-gray-700 hover:bg-gray-50 text-sm font-medium"
            title="Add an existing task"
          >
            Add Existing
          </button>

          {mounted && existingPicker && typeof document !== 'undefined' && createPortal(
            <>
              <div className="fixed inset-0 z-[9999]" onClick={() => setExistingPicker(null)} />
              <div
                ref={pickerRef}
                style={{
                  position: 'fixed',
                  top: `${Math.min(existingPicker.position.top - window.scrollY, window.innerHeight - 450)}px`,
                  left: '50%',
                  transform: 'translateX(-50%)',
                  zIndex: 10000
                }}
                className="w-[calc(100vw-32px)] sm:w-[52rem] max-w-[52rem] bg-white border border-gray-100 rounded-xl shadow-2xl p-3 max-h-[80vh] overflow-y-auto animate-fade-in"
                onClick={e => e.stopPropagation()}
              >
                <input
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg mb-2 text-sm"
                  placeholder="Search tasks..."
                  value={existingQuery}
                  onChange={e => setExistingQuery(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Escape') setExistingPicker(null)
                  }}
                  autoFocus
                />
                <div className="max-h-96 overflow-auto">
                  {allEntries.filter(entry => {
                    const title = entry.type === 'task' ? entry.task.title : `${entry.task.title} — ${entry.subtask.title}`
                    const projectTitle = entry.project?.title || ''
                    if (!existingQuery) return true
                    return title.toLowerCase().includes(existingQuery.toLowerCase()) || projectTitle.toLowerCase().includes(existingQuery.toLowerCase())
                  }).slice(0, 200).map(entry => {
                    const entryTags = entry.type === 'subtask' ? (entry.subtask.tags || []) : (entry.task.tags || [])
                    return (
                      <div key={entry.type === 'subtask' ? `s-${entry.subtask.id}` : `t-${entry.task.id}`} className="flex items-center justify-between px-2 py-2 hover:bg-gray-50 rounded-lg cursor-pointer" onClick={() => {
                        if (entry.type === 'subtask') {
                          addSubtaskToToday(entry.subtask, entry.task, { projectId: entry.project?.id })
                        } else {
                          addToToday(entry.task, { projectId: entry.project?.id })
                        }
                        setExistingPicker(null)
                      }}>
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium truncate">{entry.type === 'subtask' ? `${entry.task.title} — ${entry.subtask.title}` : entry.task.title}</div>
                          <div className="flex items-center gap-2 mt-1 flex-wrap">
                            {entry.project?.title && <span className="text-xs px-2 py-0.5 rounded bg-indigo-100 text-indigo-700">{entry.project.title}</span>}
                            {entry.stage?.name && <span className="text-xs px-2 py-0.5 rounded bg-green-100 text-green-700">{entry.stage.name}</span>}
                            {entry.type === 'subtask' && <span className="text-xs px-2 py-0.5 rounded bg-yellow-100 text-yellow-800">subtask</span>}
                            {/* Tags Display */}
                            {entryTags.map(tag => (
                              <span key={tag.id} className={`text-xs px-1.5 py-0.5 rounded ${tag.color === 'blue' ? 'bg-blue-100 text-blue-700' :
                                tag.color === 'red' ? 'bg-red-100 text-red-700' :
                                  tag.color === 'green' ? 'bg-green-100 text-green-700' :
                                    tag.color === 'amber' ? 'bg-amber-100 text-amber-700' :
                                      tag.color === 'purple' ? 'bg-purple-100 text-purple-700' :
                                        'bg-gray-100 text-gray-700'
                                }`}>{tag.name}</span>
                            ))}
                          </div>
                        </div>
                        <div className="text-xs text-gray-400 ml-2 flex-shrink-0">Add</div>
                      </div>
                    )
                  })}
                  {allEntries.length === 0 && (
                    <div className="text-sm text-gray-400 p-4 text-center">No tasks available</div>
                  )}
                </div>
              </div>
            </>,
            document.body
          )}
        </div>
      </div>

      {/* Today Subtabs */}
      <div className="flex border-b border-gray-200 mb-6 gap-6">
        {[
          { id: 'active', label: 'Active', count: todayItems.filter(i => !i.is_done).length },
          { id: 'scheduled', label: 'Scheduled', count: todayItems.filter(i => i.reminder_date && !i.is_done).length },
          { id: 'completed', label: 'Completed', count: todayItems.filter(i => i.is_done).length },
          { id: 'all', label: 'All', count: todayItems.length }
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => { setTodaySubtab(tab.id); setSelectedIds(new Set()); setIsSelectionMode(false) }}
            className={`pb-3 text-sm font-medium transition-colors relative ${todaySubtab === tab.id ? 'text-indigo-600' : 'text-gray-500 hover:text-gray-700'}`}
          >
            {tab.label}
            <span className="ml-2 px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500 text-[10px]">{tab.count}</span>
            {todaySubtab === tab.id && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-indigo-600 rounded-full" />}
          </button>
        ))}
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center gap-2 mb-3">
        <div className="relative w-full sm:w-64">
          <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={todaySearch}
            onChange={(e) => setTodaySearch(e.target.value)}
            placeholder="Search today items..."
            className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-gray-200 bg-white shadow-sm focus:ring-2 focus:ring-brand-200 focus:border-brand-400 transition"
          />
        </div>
      </div>

      <div className="space-y-2">
        {displayedTodayItems.length === 0 ? (
          <div className="p-12 text-center text-gray-400 border-2 border-dashed border-gray-100 rounded-2xl">
            {todaySubtab === 'active' ? 'No active tasks for today.' : todaySubtab === 'scheduled' ? 'No scheduled tasks with reminders.' : todaySubtab === 'completed' ? 'No completed tasks yet.' : 'Your list is empty.'}
          </div>
        ) : (
          displayedTodayItems.map((it, i) => {
            const proj = it.projectId ? projects.find(p => p.id === it.projectId) : null
            return (
              <TodayItem
                key={it.id}
                item={it}
                project={proj}
                index={i}
                isSelectionMode={isSelectionMode}
                isSelected={selectedIds.has(it.id)}
                isMenuOpen={openMenuId === it.id}
                isEditing={editingId === it.id}
                onToggleSelect={(id) => {
                  const s = new Set(selectedIds)
                  if (s.has(id)) s.delete(id)
                  else s.add(id)
                  setSelectedIds(s)
                }}
                onToggleDone={handleToggleDone}
                onMenuToggle={(id) => setOpenMenuId(openMenuId === id ? null : id)}
                onEditStart={setEditingId}
                onEditCancel={() => setEditingId(null)}
                onRename={onRenameItem}
                onDelete={removeTodayItems}
                onDuplicate={duplicateTodayItems}
                onSetReminder={setTodayItemReminder}
                onDragStart={onDragStart}
                onDragOver={onDragOver}
                onDrop={onDrop}
              />
            )
          })
        )}
      </div>

      {/* Duplicate Check Popup */}
      <DuplicatePopup />
    </div>
  )
}

function DuplicatePopup() {
  const mounted = useMounted()
  const { duplicateCheck, handleDuplicateAction } = useApp()
  if (!duplicateCheck || !mounted || typeof document === 'undefined') return null

  const { item, existingItem, type } = duplicateCheck
  const status = existingItem.is_done ? 'completed' : 'active'

  return createPortal(
    <div className="fixed inset-0 z-[10001] flex items-center justify-center p-4 bg-gray-900/40 backdrop-blur-sm animate-fade-in" onClick={() => handleDuplicateAction(null)}>
      <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-sm w-full space-y-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-3 text-amber-600">
          <div className="p-2 bg-amber-50 rounded-full">
            <AlertCircle className="w-6 h-6" />
          </div>
          <h3 className="text-lg font-bold">Already in Tod(o)ay</h3>
        </div>

        <p className="text-gray-600 text-sm">
          "<span className="font-semibold text-gray-900">{existingItem.title}</span>"
          is already in your list and is currently <span className={`font-medium ${status === 'completed' ? 'text-green-600' : 'text-blue-600'}`}>{status}</span>.
        </p>

        <div className="grid grid-cols-1 gap-2 pt-2">
          {existingItem.is_done && (
            <button
              onClick={() => handleDuplicateAction('reactivate', duplicateCheck)}
              className="w-full py-2.5 px-4 bg-indigo-600 text-white rounded-xl font-semibold hover:bg-indigo-700 transition-colors shadow-sm"
            >
              Reactivate existing
            </button>
          )}
          <button
            onClick={() => handleDuplicateAction('duplicate', duplicateCheck)}
            className="w-full py-2.5 px-4 bg-gray-100 text-gray-900 rounded-xl font-semibold hover:bg-gray-200 transition-colors"
          >
            Add as duplicate
          </button>
          <button
            onClick={() => handleDuplicateAction('cancel', duplicateCheck)}
            className="w-full py-2.5 px-4 text-gray-500 font-medium hover:text-gray-700"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}

function ProjectsView() {
  const { projects, setProjects, setView, setSelectedProject, setSelectedTask, loading, reorderProjects, addToToday, moveTaskBetweenStages, deletedProjectIdsRef } = useApp()
  const { user, demoMode } = useAuth()
  const [showCreate, setShowCreate] = useState(false)
  const [sortOption, setSortOption] = useState('priority')
  const [sortDirection, setSortDirection] = useState('asc') // 'asc' or 'desc'
  const [showReorder, setShowReorder] = useState(false)
  const [viewMode, setViewMode] = useState('kanban') // 'kanban' or 'grid' or 'list'
  const [isSelectionMode, setIsSelectionMode] = useState(false)
  const [selectedProjectIDs, setSelectedProjectIDs] = useState(new Set())

  const handleSortChange = (newOption) => {
    if (newOption === sortOption) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc')
    } else {
      setSortOption(newOption)
      // Default to descending for time-based sorts so the newest/most recent is first
      if (newOption === 'created' || newOption === 'modified') {
        setSortDirection('desc')
      } else {
        setSortDirection('asc')
      }
    }
  }

  const computeSorted = () => {
    const sorted = [...projects]
    const dir = sortDirection === 'asc' ? 1 : -1
    switch (sortOption) {
      case 'priority':
        return sorted.sort((a, b) => {
          if (a.priority_rank === b.priority_rank) return a.title.localeCompare(b.title)
          return (a.priority_rank - b.priority_rank) * dir
        })
      case 'progress':
        return sorted.sort((a, b) => {
          const progressA = getProgress(a)
          const progressB = getProgress(b)
          if (progressA === progressB) return a.title.localeCompare(b.title)
          return (progressA - progressB) * dir
        })
      case 'created':
        return sorted.sort((a, b) => {
          const dateA = new Date(a.created_at || 0).getTime()
          const dateB = new Date(b.created_at || 0).getTime()
          return (dateA - dateB) * dir
        })
      case 'modified':
        return sorted.sort((a, b) => {
          const dateA = new Date(a.updated_at || a.created_at || 0).getTime()
          const dateB = new Date(b.updated_at || b.created_at || 0).getTime()
          return (dateA - dateB) * dir
        })
      default:
        return sorted
    }
  }

  const sortedProjects = computeSorted()

  const [reorderLoading, setReorderLoading] = useState(false)
  const handleReorder = async (newOrder) => {
    setReorderLoading(true)
    const updated = newOrder.map((p, i) => ({ ...p, priority_rank: i + 1 }))
    try {
      await reorderProjects(updated)
      setShowReorder(false)
    } finally {
      setReorderLoading(false)
    }
  }

  const handleBulkDelete = () => {
    const toDelete = Array.from(selectedProjectIDs)
    if (toDelete.length === 0) return
    if (!window.confirm(`Delete ${toDelete.length} project(s) and all their data?`)) return

    if (demoMode) {
      setProjects(projects.filter(p => !selectedProjectIDs.has(p.id)))
    } else {
      // In real mode, delete each
      toDelete.forEach(id => db.deleteProject(id))
      setProjects(projects.filter(p => !selectedProjectIDs.has(p.id)))
    }
    setSelectedProjectIDs(new Set())
    setIsSelectionMode(false)
  }

  const duplicateSelectedProjects = async () => {
    const toDup = Array.from(selectedProjectIDs)
    if (toDup.length === 0) return

    const now = new Date().toISOString()
    const newProjectsArr = []

    // Build duplicated projects locally first
    for (const id of toDup) {
      const original = projects.find(p => p.id === id)
      if (!original) continue
      const duplicatedProject = {
        ...original,
        id: uuid(),
        title: `${original.title} (Copy)`,
        priority_rank: projects.length + 1 + newProjectsArr.length,
        created_at: now,
        updated_at: now,
        owner_id: user?.id || 'demo',
        project_members: [],
        stages: original.stages?.map(stage => ({
          ...stage,
          id: uuid(),
          tasks: stage.tasks?.map(task => ({
            ...task,
            id: uuid(),
            created_at: now,
            updated_at: now,
            subtasks: task.subtasks?.map(st => ({ ...st, id: uuid() })) || [],
            comments: []
          })) || []
        })) || []
      }
      newProjectsArr.push(duplicatedProject)
    }

    if (newProjectsArr.length === 0) return

    if (demoMode) {
      const merged = [...projects, ...newProjectsArr]
      setProjects(merged)
      saveLocal(merged)
      setSelectedProjectIDs(new Set())
      setIsSelectionMode(false)
      return
    }

    // Persist in Supabase: create projects, stages, tasks, subtasks, then refresh once
    for (const dup of newProjectsArr) {
      try {
        const { data: createdProject, error: projectError } = await db.createProject({
          title: dup.title,
          emoji: dup.emoji,
          priority_rank: dup.priority_rank,
          current_stage_index: dup.current_stage_index,
          owner_id: user.id
        })
        if (projectError || !createdProject) {
          derr('Failed to duplicate project:', projectError)
          continue
        }

        for (const stage of dup.stages || []) {
          const { data: createdStage, error: stageError } = await db.createStage({
            project_id: createdProject.id,
            name: stage.name,
            order_index: stage.order_index
          })
          if (stageError || !createdStage) {
            derr('Failed to create stage:', stageError)
            continue
          }

          for (const task of stage.tasks || []) {
            const { data: createdTask, error: taskError } = await db.createTask({
              stage_id: createdStage.id,
              title: task.title,
              description: task.description || '',
              is_completed: task.is_completed || false,
              reminder_date: task.reminder_date,
              order_index: task.order_index || 0
            })
            if (taskError || !createdTask) {
              derr('Failed to create task:', taskError)
              continue
            }
            for (const st of task.subtasks || []) {
              await db.createSubtask({ ...st, task_id: createdTask.id })
            }
          }
        }
      } catch (e) {
        derr('Bulk duplicate error', e)
      }
    }

    // Refresh projects list once
    try {
      const { data: refreshed } = await db.getProjects(user.id)
      if (refreshed) setProjects(refreshed)
    } catch (e) {
      derr('Failed to refresh projects after duplication', e)
    }

    setSelectedProjectIDs(new Set())
    setIsSelectionMode(false)
  }

  const deleteProject = async (id) => {
    if (!window.confirm('Delete this project and all its data?')) return

    // Guard: mark as deleted so realtime handler won't resurrect it
    deletedProjectIdsRef.current.add(id)

    if (demoMode) {
      setProjects(projects.filter(p => p.id !== id))
    } else {
      setProjects(projects.filter(p => p.id !== id))
      await db.deleteProject(id)
    }

    // Cleanup guard after propagation delay
    setTimeout(() => deletedProjectIdsRef.current.delete(id), 8000)
  }

  const duplicateProject = async (projectToDuplicate) => {
    // Create new IDs for the duplicated project and its stages/tasks
    const newProjectId = uuid()
    const newPriorityRank = projects.length + 1
    const now = new Date().toISOString()

    const duplicatedProject = {
      ...projectToDuplicate,
      id: newProjectId,
      title: `${projectToDuplicate.title} (Copy)`,
      priority_rank: newPriorityRank,
      created_at: now,
      updated_at: now,
      owner_id: user?.id || 'demo',
      project_members: [],
      stages: projectToDuplicate.stages?.map(stage => ({
        ...stage,
        id: uuid(),
        tasks: stage.tasks?.map(task => ({
          ...task,
          id: uuid(),
          created_at: now,
          updated_at: now,
          subtasks: task.subtasks?.map(st => ({ ...st, id: uuid() })) || [],
          comments: []
        })) || []
      })) || []
    }

    if (demoMode) {
      setProjects([...projects, duplicatedProject])
      saveLocal([...projects, duplicatedProject])
    } else {
      // Create project in Supabase
      const { data: createdProject, error: projectError } = await db.createProject({
        title: duplicatedProject.title,
        emoji: duplicatedProject.emoji,
        priority_rank: duplicatedProject.priority_rank,
        current_stage_index: duplicatedProject.current_stage_index,
        owner_id: user.id
      })

      if (projectError || !createdProject) {
        derr('Failed to duplicate project:', projectError)
        return
      }

      // Create stages and tasks
      for (const stage of duplicatedProject.stages) {
        const { data: createdStage, error: stageError } = await db.createStage({
          project_id: createdProject.id,
          name: stage.name,
          order_index: stage.order_index
        })

        if (stageError || !createdStage) {
          derr('Failed to create stage:', stageError)
          continue
        }

        // Create tasks for this stage
        for (const task of stage.tasks || []) {
          await db.createTask({
            stage_id: createdStage.id,
            title: task.title,
            description: task.description || '',
            is_completed: task.is_completed || false,
            reminder_date: task.reminder_date,
            order_index: task.order_index || 0
          })
        }
      }

      // Refresh projects list
      const { data: refreshed } = await db.getProjects(user.id)
      if (refreshed) setProjects(refreshed)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 animate-spin text-brand-600" />
      </div>
    )
  }

  const toggleProjectSelection = (projectId, e) => {
    e?.stopPropagation()
    const newSelected = new Set(selectedProjectIDs)
    if (newSelected.has(projectId)) {
      newSelected.delete(projectId)
    } else {
      newSelected.add(projectId)
    }
    setSelectedProjectIDs(newSelected)
  }

  const selectAllProjects = () => {
    if (selectedProjectIDs.size === sortedProjects.length) {
      setSelectedProjectIDs(new Set())
    } else {
      setSelectedProjectIDs(new Set(sortedProjects.map(p => p.id)))
    }
  }

  const openProject = (project) => {
    setSelectedProject(project)
    setView('project')
  }

  const openTask = (project, task, stageIndex) => {
    setSelectedProject(project)
    setSelectedTask({ task, stageIndex })
    setView('task')
  }

  return (
    <div className="mx-auto max-w-[96rem] px-3 py-6 sm:px-6 sm:py-8 lg:px-8">
      <div className="flex flex-col gap-4 mb-6 sm:mb-8">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-gray-900">My Projects</h1>
            <p className="text-gray-500 text-sm mt-1">{projects.length} project{projects.length !== 1 ? 's' : ''}</p>
          </div>
          <div className="flex items-center gap-2">
            {isSelectionMode ? (
              <>
                <button
                  onClick={selectAllProjects}
                  className="text-xs sm:text-sm px-3 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200"
                >
                  {selectedProjectIDs.size === sortedProjects.length ? 'Deselect All' : 'Select All'}
                </button>
                <button
                  onClick={handleBulkDelete}
                  disabled={selectedProjectIDs.size === 0}
                  className="text-xs sm:text-sm px-3 py-1.5 rounded-lg bg-red-100 text-red-600 hover:bg-red-200 disabled:opacity-50 flex items-center gap-1"
                >
                  <Trash2 className="w-3 h-3" />
                  Delete ({selectedProjectIDs.size})
                </button>
                <button
                  onClick={duplicateSelectedProjects}
                  disabled={selectedProjectIDs.size === 0}
                  className="text-xs sm:text-sm px-3 py-1.5 rounded-lg bg-gray-800 text-white hover:bg-gray-700 disabled:opacity-50 flex items-center gap-1"
                >
                  <Copy className="w-3 h-3" />
                  Duplicate ({selectedProjectIDs.size})
                </button>
                <button
                  onClick={() => { setIsSelectionMode(false); setSelectedProjectIDs(new Set()) }}
                  className="text-xs sm:text-sm px-3 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200"
                >
                  Cancel
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={() => setIsSelectionMode(true)}
                  className="text-xs sm:text-sm px-3 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 flex items-center gap-1"
                >
                  <Check className="w-3 h-3" />
                  <span className="hidden sm:inline">Select</span>
                </button>
                <button onClick={() => setShowCreate(true)} className="btn-gradient flex items-center gap-2 whitespace-nowrap text-sm sm:text-base px-3 sm:px-6 py-2 sm:py-3">
                  <Plus className="w-4 h-4" />
                  <span className="hidden sm:inline">New Project</span>
                </button>
              </>
            )}
          </div>
        </div>

        {/* Controls row - scrollable on mobile */}
        <div className="flex items-center gap-2 overflow-x-auto pb-2 -mx-3 px-3 sm:mx-0 sm:px-0">
          {/* View Toggle */}
          <div className="flex items-center bg-gray-100 rounded-lg p-1 flex-shrink-0">
            <button
              onClick={() => setViewMode('kanban')}
              className={`p-2 rounded-md transition-colors ${viewMode === 'kanban' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}
              title="Kanban view"
            >
              <Kanban className="w-4 h-4" />
            </button>
            <button
              onClick={() => setViewMode('grid')}
              className={`p-2 rounded-md transition-colors ${viewMode === 'grid' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'
                }`}
              title="Grid view"
            >
              <LayoutGrid className="w-4 h-4" />
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={`p-2 rounded-md transition-colors ${viewMode === 'list' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'
                }`}
              title="List view"
            >
              <List className="w-4 h-4" />
            </button>
          </div>

          {/* Sort options */}
          <div className="flex items-center gap-1 flex-shrink-0">
            {[{ key: 'priority', label: 'Priority' }, { key: 'progress', label: 'Progress' }, { key: 'created', label: 'Created' }, { key: 'modified', label: 'Modified' }].map(opt => (
              <button
                key={opt.key}
                onClick={() => handleSortChange(opt.key)}
                className={`px-2 sm:px-3 py-1.5 sm:py-2 text-xs sm:text-sm rounded-lg transition-colors flex items-center gap-1 whitespace-nowrap ${sortOption === opt.key
                  ? 'bg-gray-200 text-gray-900 font-medium'
                  : 'text-gray-600 hover:bg-gray-100'
                  }`}
              >
                {opt.label}
                {sortOption === opt.key && (
                  sortDirection === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />
                )}
              </button>
            ))}
          </div>

          <button id="projects-reorder-btn" onClick={() => setShowReorder(true)} className="btn-gradient flex items-center gap-2 whitespace-nowrap flex-shrink-0 text-sm px-3 py-2">
            <MoreVertical className="w-4 h-4" />
            <span className="hidden sm:inline">Reorder</span>
          </button>
        </div>
      </div>

      {sortedProjects.length === 0 ? (
        <div className="glass-card rounded-2xl p-8 sm:p-12 text-center">
          <div className="text-5xl sm:text-6xl mb-4">🔬</div>
          <h2 className="text-lg sm:text-xl font-bold text-gray-900 mb-2">No projects yet</h2>
          <p className="text-gray-500 mb-6 text-sm sm:text-base">Create your first research project to get started</p>
          <button onClick={() => setShowCreate(true)} className="btn-gradient">
            Create Project
          </button>
        </div>
      ) : viewMode === 'kanban' ? (
        <KanbanScrollContainer>
          <div className="flex min-w-max items-stretch gap-4 pr-2">
            {sortedProjects.map((project, i) => (
              <KanbanProjectLane
                key={project.id}
                project={project}
                index={i}
                isSelectionMode={isSelectionMode}
                isSelected={selectedProjectIDs.has(project.id)}
                onToggleSelect={(projectId) => toggleProjectSelection(projectId)}
                onOpenProject={openProject}
                onOpenTask={openTask}
                onDelete={deleteProject}
                onDuplicate={duplicateProject}
                onAddToToday={addToToday}
                onMoveTask={moveTaskBetweenStages}
              />
            ))}
          </div>
        </KanbanScrollContainer>
      ) : viewMode === 'grid' ? (
        <div className="grid gap-2 sm:gap-6 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          {sortedProjects.map((project, i) => (
            <ProjectCard
              key={project.id}
              rootId={i === 0 ? 'project-card-0' : undefined}
              project={project}
              index={i}
              isSelectionMode={isSelectionMode}
              isSelected={selectedProjectIDs.has(project.id)}
              onToggleSelect={(e) => toggleProjectSelection(project.id, e)}
              onSelect={() => {
                if (isSelectionMode) {
                  toggleProjectSelection(project.id)
                } else {
                  openProject(project)
                }
              }}
              onDelete={() => deleteProject(project.id)}
              onDuplicate={() => duplicateProject(project)}
            />
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {sortedProjects.map((project, i) => (
            <ProjectListItem
              key={project.id}
              project={project}
              index={i}
              isSelectionMode={isSelectionMode}
              isSelected={selectedProjectIDs.has(project.id)}
              onToggleSelect={(e) => toggleProjectSelection(project.id, e)}
              onSelect={() => {
                if (isSelectionMode) {
                  toggleProjectSelection(project.id)
                } else {
                  openProject(project)
                }
              }}
              onDelete={() => deleteProject(project.id)}
              onDuplicate={() => duplicateProject(project)}
            />
          ))}
        </div>
      )}

      {showCreate && <CreateProjectModal onClose={() => setShowCreate(false)} />}

      {showReorder && (
        <ReorderModal
          projects={sortedProjects}
          onReorder={handleReorder}
          onClose={() => setShowReorder(false)}
        />
      )}
    </div>
  )
}

// ============================================
// REORDER MODAL
// ============================================
function ReorderModal({ projects, onReorder, onClose }) {
  const [workingProjects, setWorkingProjects] = useState([...projects])
  const [draggedIndex, setDraggedIndex] = useState(null)

  const handleDragStart = (e, index) => {
    setDraggedIndex(index)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/html', e.target)
  }

  const handleDragOver = (e, index) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }

  const handleDrop = (e, dropIndex) => {
    e.preventDefault()
    const dragIndex = draggedIndex
    if (dragIndex === dropIndex) return

    const newProjects = [...workingProjects]
    const [draggedItem] = newProjects.splice(dragIndex, 1)
    newProjects.splice(dropIndex, 0, draggedItem)
    setWorkingProjects(newProjects)
    setDraggedIndex(null)
  }

  const handleDragEnd = () => {
    setDraggedIndex(null)
  }

  const { reorderLoading } = useApp();
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="glass-card rounded-2xl w-full max-w-lg max-h-[80vh] overflow-y-auto animate-fade-in"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex justify-between items-center p-6 border-b border-gray-200">
          <h2 className="text-xl font-bold text-gray-900">Reorder Priorities</h2>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg" disabled={reorderLoading}>
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        <div className="p-6">
          <p className="text-gray-600 mb-4">Drag to reorder projects by priority (1 = highest)</p>
          <div className="space-y-3">
            {workingProjects.map((project, index) => (
              <div
                key={project.id}
                draggable
                onDragStart={(e) => handleDragStart(e, index)}
                onDragOver={(e) => handleDragOver(e, index)}
                onDrop={(e) => handleDrop(e, index)}
                onDragEnd={handleDragEnd}
                className={`flex items-center gap-3 p-3 glass-card rounded-lg cursor-move transition-all duration-200 ${draggedIndex === index ? 'opacity-50 scale-95' : ''
                  }`}
              >
                <GripVertical className="w-5 h-5 text-gray-400" />
                <span className="text-2xl">{project.emoji}</span>
                <span className="font-medium text-gray-900 flex-1">{project.title}</span>
                <span className="text-sm text-gray-500">#{index + 1}</span>
              </div>
            ))}
          </div>
          <div className="flex gap-3 mt-6">
            <button onClick={onClose} className="flex-1 py-2 px-4 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50" disabled={reorderLoading}>
              Cancel
            </button>
            <button onClick={() => onReorder(workingProjects)} className="flex-1 btn-gradient" disabled={reorderLoading}>
              {reorderLoading ? 'Saving...' : 'Save Order'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ============================================
// PRIORITY BADGE COMPONENT
// ============================================
function PriorityBadge({ rank, position }) {
  const display = (position !== null && position !== undefined) ? position : rank
  return (
    <span
      className="inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold text-white bg-gray-400"
      title={`Priority ${display}`}
    >
      {display}
    </span>
  )
}

// ============================================
// PROJECT CARD (Grid View)
// ============================================
function ProjectCard({ rootId, project, index, onSelect, onDelete, onDuplicate, isSelectionMode, isSelected, onToggleSelect }) {
  const { user } = useAuth()
  const [showMenu, setShowMenu] = useState(false)
  const liveProject = project

  // Memoize expensive calculations
  const stats = useMemo(() => {
    const prog = getProgress(liveProject)
    const activeData = (liveProject.stages || []).reduce((acc, s) => acc + ((s.tasks || []).filter(t => !t.is_completed).length), 0)

    // Count reminders set on tasks and subtasks
    const remData = (liveProject.stages || []).reduce((pAcc, s) => {
      const tasksWithReminders = (s.tasks || []).reduce((tAcc, t) => {
        const subtaskReminders = (t.subtasks || []).filter(st => !!st.reminder_date).length
        return tAcc + (t.reminder_date ? 1 : 0) + subtaskReminders
      }, 0)
      return pAcc + tasksWithReminders
    }, 0)

    // Count overdue reminders (reminder date in past and not completed)
    const overdueData = (liveProject.stages || []).reduce((pAcc, s) => {
      const tasksOverdue = (s.tasks || []).reduce((tAcc, t) => {
        const subtaskOverdue = (t.subtasks || []).filter(st => st.reminder_date && isOverdue(st.reminder_date) && !st.is_completed).length
        const taskOverdue = (t.reminder_date && isOverdue(t.reminder_date) && !t.is_completed) ? 1 : 0
        return tAcc + taskOverdue + subtaskOverdue
      }, 0)
      return pAcc + tasksOverdue
    }, 0)

    return { progress: prog, activeTasksCount: activeData, reminderCount: remData, overdueCount: overdueData }
  }, [liveProject])

  const { progress, activeTasksCount, reminderCount, overdueCount } = stats

  const latestModified = useMemo(() => getProjectLatestUpdatedAt(liveProject), [liveProject])

  const currentStage = liveProject.stages?.[liveProject.current_stage_index]

  // Show shared badge if: user is not owner (shared with them) OR project has members (owner has shared it)
  const isCollaborator = liveProject.owner_id !== user?.id
  const hasMembers = liveProject.project_members?.length > 0
  const isShared = isCollaborator || hasMembers
  const isComplete = progress >= 1
  const currentUserName = user?.user_metadata?.name || user?.email || 'Unknown'

  return (
    <div
      className={`glass-card glass-card-hover rounded-xl sm:rounded-2xl p-3 sm:p-5 cursor-pointer relative animate-fade-in ${isComplete ? 'bg-green-50/80 border-green-200' : ''} ${isSelected ? 'ring-2 ring-brand-500 bg-brand-50' : ''}`}
      style={{ animationDelay: `${index * 50}ms` }}
      onClick={onSelect}
    >
      {/* Mobile: Compact horizontal layout with priority FIRST */}
      <div className="sm:hidden">
        <div className="flex items-center gap-2">
          {/* Priority badge first on mobile for long project titles */}
          <PriorityBadge position={index + 1} rank={project.priority_rank} />
          {isSelectionMode && (
            <button
              onClick={(e) => { e.stopPropagation(); onToggleSelect(e); }}
              className={`w-5 h-5 rounded border-2 flex-shrink-0 flex items-center justify-center transition-colors ${isSelected
                ? 'bg-brand-600 border-brand-600 text-white'
                : 'border-gray-300 hover:border-gray-400'
                }`}
            >
              {isSelected && <Check className="w-3 h-3" />}
            </button>
          )}
          <span className="text-2xl flex-shrink-0">{project.emoji}</span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="font-bold text-sm text-gray-900 truncate">{project.title}</h3>
              {isShared && (
                <span id={rootId ? `${rootId}-shared` : undefined} className="tag tag-shared bg-blue-100 text-blue-600 text-[8px] px-1.5 py-0.5 flex-shrink-0">
                  <Share2 className="w-2 h-2" />
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 mt-1">
              <span className={`tag text-[9px] py-0.5 px-1.5 ${isComplete ? 'bg-green-100 text-green-700' : 'tag-default'}`}>{isComplete ? '✓ Complete' : currentStage?.name || 'No stage'}</span>
              {activeTasksCount > 0 && (
                <span className="tag bg-amber-100 text-amber-700 text-[10px] px-2 py-0.5 flex items-center gap-2">
                  <span className="font-medium">{activeTasksCount}</span>
                  <span className="text-[9px] text-amber-700">{activeTasksCount === 1 ? 'active task' : 'active tasks'}</span>
                </span>
              )}
              {reminderCount > 0 && (
                <span className="tag bg-blue-50 text-blue-700 text-[10px] px-2 py-0.5 flex items-center gap-2">
                  <span className="font-medium">{reminderCount}</span>
                  <span className="text-[9px] text-blue-700">{reminderCount === 1 ? 'reminder' : 'reminders'}</span>
                </span>
              )}
              {overdueCount > 0 && (
                <span className="tag bg-red-50 text-red-700 text-[10px] px-2 py-0.5 flex items-center gap-2">
                  <span className="font-medium">{overdueCount}</span>
                  <span className="text-[9px] text-red-700">{overdueCount === 1 ? 'overdue task' : 'overdue tasks'}</span>
                </span>
              )}
              <div className={`flex-1 h-1.5 rounded-full overflow-hidden ${isComplete ? 'bg-green-200' : 'bg-gray-200'}`}>
                <div className={`h-full rounded-full ${isComplete ? 'bg-green-500' : 'bg-gradient-to-r from-gray-300 to-gray-500'}`} style={{ width: `${progress * 100}%` }} />
              </div>
              <span className={`text-[10px] font-medium ${isComplete ? 'text-green-600' : 'text-gray-500'}`}>{Math.round(progress * 100)}%</span>
            </div>
          </div>
          {!isSelectionMode && (
            <button
              onClick={e => { e.stopPropagation(); setShowMenu(!showMenu); }}
              className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors flex-shrink-0"
            >
              <MoreVertical className="w-4 h-4 text-gray-400" />
            </button>
          )}
        </div>
      </div>

      {/* Desktop: Original layout */}
      <div className="hidden sm:block">
        {/* Selection checkbox for desktop */}
        {isSelectionMode && (
          <button
            onClick={(e) => { e.stopPropagation(); onToggleSelect(e); }}
            className={`absolute top-3 right-3 w-6 h-6 rounded border-2 flex items-center justify-center transition-colors z-10 ${isSelected
              ? 'bg-brand-600 border-brand-600 text-white'
              : 'border-gray-300 hover:border-gray-400 bg-white'
              }`}
          >
            {isSelected && <Check className="w-4 h-4" />}
          </button>
        )}

        {/* Priority Badge */}
        <div className="absolute top-3 left-3 flex items-center gap-2">
          <PriorityBadge position={index + 1} rank={project.priority_rank} />
          {isShared && (
            <span id={rootId ? `${rootId}-shared-desktop` : undefined} className="tag tag-shared bg-blue-100 text-blue-600 text-[9px]">
              <Share2 className="w-2.5 h-2.5 mr-0.5" />
              Shared
            </span>
          )}
        </div>

        <div className="flex items-start gap-4 mb-4 mt-6">
          <span className="text-4xl">{project.emoji}</span>
          <div className="flex-1 min-w-0">
            <h3 className="font-bold text-lg text-gray-900 truncate">{project.title}</h3>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <span className="tag tag-default">{currentStage?.name || 'No stage'}</span>
              {project.project_members?.length > 0 && (
                <span className="tag tag-primary flex items-center gap-1">
                  <Users className="w-3 h-3" />
                  {project.project_members.length + 1}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className={`rounded-xl p-4 ${isComplete ? 'bg-green-100' : 'bg-gray-100'}`}>
          <div className="flex justify-between items-center mb-2">
            <div className="flex items-center gap-3">
              <span className={`text-xs font-medium ${isComplete ? 'text-green-600' : 'text-gray-500'}`}>{isComplete ? '✓ Complete' : 'Progress'}</span>
              {activeTasksCount > 0 && (
                <span className="hidden sm:inline-flex items-center gap-2 text-[11px] px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-100">
                  <span className="font-medium">{activeTasksCount}</span>
                  <span className="text-[11px]">{activeTasksCount === 1 ? 'active task' : 'active tasks'}</span>
                </span>
              )}
              {reminderCount > 0 && (
                <span className="hidden sm:inline-flex items-center gap-2 text-[11px] px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-100">
                  <span className="font-medium">{reminderCount}</span>
                  <span className="text-[11px]">{reminderCount === 1 ? 'reminder' : 'reminders'}</span>
                </span>
              )}
              {overdueCount > 0 && (
                <span className="hidden sm:inline-flex items-center gap-2 text-[11px] px-2 py-0.5 rounded-full bg-red-50 text-red-700 border border-red-100">
                  <span className="font-medium">{overdueCount}</span>
                  <span className="text-[11px]">{overdueCount === 1 ? 'overdue task' : 'overdue tasks'}</span>
                </span>
              )}
            </div>
            <span className={`text-sm font-bold ${isComplete ? 'text-green-700' : 'text-gray-900'}`}>{Math.round(progress * 100)}%</span>
          </div>
          <div className={`progress-bar ${isComplete ? 'bg-green-200' : ''}`}>
            <div className={isComplete ? 'h-full bg-green-500 rounded' : 'progress-bar-fill'} style={{ width: `${progress * 100}%` }} />
          </div>
          {/* Timestamps */}
          <div className="flex items-center justify-between mt-3 pt-3 border-t border-gray-200">
            {liveProject.created_at && (
              <span className="text-[10px] text-gray-400" title={`Created: ${new Date(liveProject.created_at).toLocaleString()}`}>
                Created {formatRelativeDate(liveProject.created_at)}
              </span>
            )}
            {getProjectLatestUpdatedAt(liveProject) && getProjectLatestUpdatedAt(liveProject) !== liveProject.created_at && (
              <span className="text-[10px] text-gray-400" title={`Modified: ${new Date(getProjectLatestUpdatedAt(liveProject)).toLocaleString()}${liveProject.modified_by_name ? ` by ${liveProject.modified_by_name}` : ''}`}>
                Modified {formatModifiedBy(getProjectLatestUpdatedAt(liveProject), liveProject.modified_by_name, user?.user_metadata?.name || user?.email || 'Unknown')}
              </span>
            )}
          </div>
        </div>

        {!isSelectionMode && (
          <button
            onClick={e => { e.stopPropagation(); setShowMenu(!showMenu); }}
            className="absolute top-4 right-4 p-2 rounded-lg hover:bg-gray-100 transition-colors"
          >
            <MoreVertical className="w-4 h-4 text-gray-400" />
          </button>
        )}
      </div>

      {showMenu && !isSelectionMode && (
        <>
          <div className="fixed inset-0 z-40" onClick={e => { e.stopPropagation(); setShowMenu(false); }} />
          <div className="absolute top-8 sm:top-12 right-2 sm:right-4 glass-card rounded-xl shadow-lg z-50 py-1 min-w-[140px] animate-fade-in" onClick={e => e.stopPropagation()}>
            <button
              onClick={() => { setShowMenu(false); onDuplicate(); }}
              className="w-full px-4 py-2 text-left text-sm hover:bg-gray-50 flex items-center gap-2"
            >
              <Copy className="w-4 h-4" />
              Duplicate
            </button>
            <button
              onClick={() => { setShowMenu(false); onDelete(); }}
              className="w-full px-4 py-2 text-left text-sm text-red-600 hover:bg-red-50 flex items-center gap-2"
            >
              <Trash2 className="w-4 h-4" />
              Delete
            </button>
          </div>
        </>
      )}
    </div>
  )
}

// ============================================
// PROJECT LIST ITEM (List View)
// ============================================
function ProjectListItem({ project, index, onSelect, onDelete, onDuplicate, isSelectionMode, isSelected, onToggleSelect }) {
  const { user } = useAuth()
  const [showMenu, setShowMenu] = useState(false)
  const liveProject = project

  // Memoize stats
  const stats = useMemo(() => {
    const prog = getProgress(liveProject)
    const activeData = (liveProject.stages || []).reduce((acc, s) => acc + ((s.tasks || []).filter(t => !t.is_completed).length), 0)

    // Count reminders set on tasks and subtasks
    const remData = (liveProject.stages || []).reduce((pAcc, s) => {
      const tasksWithReminders = (s.tasks || []).reduce((tAcc, t) => {
        const subtaskReminders = (t.subtasks || []).filter(st => !!st.reminder_date).length
        return tAcc + (t.reminder_date ? 1 : 0) + subtaskReminders
      }, 0)
      return pAcc + tasksWithReminders
    }, 0)

    // Count overdue reminders (reminder date in past and not completed)
    const overdueData = (liveProject.stages || []).reduce((pAcc, s) => {
      const tasksOverdue = (s.tasks || []).reduce((tAcc, t) => {
        const subtaskOverdue = (t.subtasks || []).filter(st => st.reminder_date && isOverdue(st.reminder_date) && !st.is_completed).length
        const taskOverdue = (t.reminder_date && isOverdue(t.reminder_date) && !t.is_completed) ? 1 : 0
        return tAcc + taskOverdue + subtaskOverdue
      }, 0)
      return pAcc + tasksOverdue
    }, 0)
    return { progress: prog, activeTasksCount: activeData, reminderCount: remData, overdueCount: overdueData }
  }, [liveProject])

  const { progress, activeTasksCount, reminderCount, overdueCount } = stats
  const currentStage = liveProject.stages?.[liveProject.current_stage_index]
  const totalStages = liveProject.stages?.length || 0
  const completedStages = liveProject.current_stage_index || 0
  // Show shared badge if: user is not owner (shared with them) OR project has members (owner has shared it)
  const isCollaborator = liveProject.owner_id !== user?.id
  const hasMembers = liveProject.project_members?.length > 0
  const isShared = isCollaborator || hasMembers
  const isComplete = progress >= 1
  const currentUserName = user?.user_metadata?.name || user?.email || 'Unknown'

  return (
    <div
      className={`glass-card glass-card-hover rounded-xl p-3 sm:p-4 cursor-pointer relative animate-fade-in overflow-visible ${isComplete ? 'bg-green-50/80 border-green-200' : ''} ${isSelected ? 'ring-2 ring-brand-500 bg-brand-50' : ''}`}
      style={{ animationDelay: `${index * 30}ms` }}
      onClick={onSelect}
    >
      <div className="flex items-center gap-2 sm:gap-4">
        {/* Selection checkbox */}
        {isSelectionMode && (
          <button
            onClick={(e) => { e.stopPropagation(); onToggleSelect(e); }}
            className={`w-5 h-5 rounded border-2 flex-shrink-0 flex items-center justify-center transition-colors ${isSelected
              ? 'bg-brand-600 border-brand-600 text-white'
              : 'border-gray-300 hover:border-gray-400'
              }`}
          >
            {isSelected && <Check className="w-3 h-3" />}
          </button>
        )}


        {/* Priority Badge */}
        <PriorityBadge position={index + 1} rank={project.priority_rank} />

        {/* Emoji */}
        <span className="text-xl sm:text-2xl flex-shrink-0">{project.emoji}</span>

        {/* Title and Stage - Takes most space */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-gray-900 truncate">{project.title}</h3>
            {isShared && (
              <span className="tag bg-blue-100 text-blue-600 text-[9px] hidden sm:inline-flex">
                <Share2 className="w-2.5 h-2.5 mr-0.5" />
                Shared
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            <span className="text-xs text-gray-500">{currentStage?.name || 'No stage'}</span>
            {isShared && (
              <span className="text-[9px] text-blue-500 sm:hidden">Shared</span>
            )}
            {liveProject.project_members?.length > 0 && (
              <span className="text-xs text-gray-400 flex items-center gap-1">
                <Users className="w-3 h-3" />
                {liveProject.project_members.length + 1}
              </span>
            )}
            <span className="text-[10px] text-gray-300 hidden sm:inline">•</span>
            {getProjectLatestUpdatedAt(liveProject) ? (
              <span className="text-[10px] text-gray-400 hidden sm:inline" title={`Modified: ${new Date(getProjectLatestUpdatedAt(liveProject)).toLocaleString()}${liveProject.modified_by_name ? ` by ${liveProject.modified_by_name}` : ''}`}>
                {formatModifiedBy(getProjectLatestUpdatedAt(liveProject), liveProject.modified_by_name, user?.user_metadata?.name || user?.email || 'Unknown')}
              </span>
            ) : liveProject.created_at && (
              <span className="text-[10px] text-gray-400 hidden sm:inline" title={`Created: ${new Date(liveProject.created_at).toLocaleString()}`}>
                {formatRelativeDate(liveProject.created_at)}
              </span>
            )}
          </div>
        </div>

        {/* Progress - Compact display */}
        <div className="flex items-center gap-3 flex-shrink-0">
          {/* Stage Progress Dots */}
          <div className="hidden lg:flex items-center gap-1" title={`Stage ${completedStages + 1} of ${totalStages}`}>
            {project.stages?.slice(0, 7).map((stage, i) => (
              <div
                key={stage.id}
                className={`w-2 h-2 rounded-full transition-colors ${i < completedStages
                  ? 'bg-green-500'
                  : i === completedStages
                    ? 'bg-blue-500'
                    : 'bg-gray-200'
                  }`}
                title={stage.name}
              />
            ))}
            {totalStages > 7 && (
              <span className="text-xs text-gray-400">+{totalStages - 7}</span>
            )}
          </div>

          {/* Percentage */}
          <div className="hidden sm:flex items-center gap-2 min-w-[60px]">
            <div className={`w-12 h-1.5 rounded-full overflow-hidden ${isComplete ? 'bg-green-200' : 'bg-gray-200'}`}>
              <div
                className={`h-full rounded-full transition-all ${isComplete ? 'bg-green-500' : 'bg-gradient-to-r from-blue-500 to-green-500'}`}
                style={{ width: `${progress * 100}%` }}
              />
            </div>
            {activeTasksCount > 0 && (
              <span className="inline-flex items-center gap-2 px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 text-xs border border-amber-100">
                <span className="font-medium">{activeTasksCount}</span>
                <span>{activeTasksCount === 1 ? 'active task' : 'active tasks'}</span>
              </span>
            )}
            {reminderCount > 0 && (
              <span className="inline-flex items-center gap-2 px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 text-xs border border-blue-100">
                <span className="font-medium">{reminderCount}</span>
                <span>{reminderCount === 1 ? 'reminder' : 'reminders'}</span>
              </span>
            )}
            {overdueCount > 0 && (
              <span className="inline-flex items-center gap-2 px-2 py-0.5 rounded-full bg-red-50 text-red-700 text-xs border border-red-100">
                <span className="font-medium">{overdueCount}</span>
                <span>{overdueCount === 1 ? 'overdue task' : 'overdue tasks'}</span>
              </span>
            )}
            <span className={`text-xs font-medium w-8 ${isComplete ? 'text-green-600' : 'text-gray-600'}`}>{Math.round(progress * 100)}%</span>
          </div>
        </div>

        {/* Menu Button */}
        {!isSelectionMode && (
          <button
            onClick={e => { e.stopPropagation(); setShowMenu(!showMenu); }}
            className="p-2 rounded-lg hover:bg-gray-100 transition-colors flex-shrink-0"
          >
            <MoreVertical className="w-4 h-4 text-gray-400" />
          </button>
        )}
      </div>

      {showMenu && !isSelectionMode && (
        <>
          <div className="fixed inset-0 z-40" onClick={e => { e.stopPropagation(); setShowMenu(false); }} />
          <div className="absolute top-12 right-4 glass-card rounded-xl shadow-lg z-50 py-1 min-w-[140px] animate-fade-in" onClick={e => e.stopPropagation()}>
            <button
              onClick={() => { setShowMenu(false); onDuplicate(); }}
              className="w-full px-4 py-2 text-left text-sm hover:bg-gray-50 flex items-center gap-2"
            >
              <Copy className="w-4 h-4" />
              Duplicate
            </button>
            <button
              onClick={() => { setShowMenu(false); onDelete(); }}
              className="w-full px-4 py-2 text-left text-sm text-red-600 hover:bg-red-50 flex items-center gap-2"
            >
              <Trash2 className="w-4 h-4" />
              Delete
            </button>
          </div>
        </>
      )}
    </div>
  )
}

// ============================================
// KANBAN SCROLL CONTAINER — click-and-drag horizontal scroll
// ============================================
function KanbanScrollContainer({ children }) {
  const containerRef = useRef(null)
  const isPointerDown = useRef(false)
  const isDragging = useRef(false)
  const startX = useRef(0)
  const scrollLeft = useRef(0)

  // Touch (phone/tablet) uses the browser's native momentum scrolling — we only
  // wire up custom click-drag for mouse so the lane can be grabbed anywhere.
  const onMouseDown = (e) => {
    // Only left button; let text fields and the draggable task cards keep their
    // own behavior (typing, native drag-to-move-between-stages).
    if (e.button !== 0) return
    if (e.target.closest('input, textarea, select, [contenteditable="true"], [draggable="true"]')) return
    isPointerDown.current = true
    isDragging.current = false
    startX.current = e.pageX - containerRef.current.offsetLeft
    scrollLeft.current = containerRef.current.scrollLeft
  }

  const onMouseMove = (e) => {
    if (!isPointerDown.current) return
    const x = e.pageX - containerRef.current.offsetLeft
    const walk = (x - startX.current) * 1.5 // scroll speed multiplier
    // Only start treating it as a drag once the pointer moves past a small
    // threshold, so plain clicks on headers/buttons still register.
    if (!isDragging.current && Math.abs(walk) > 5) {
      isDragging.current = true
      containerRef.current.classList.add('kanban-scroll--grabbing')
    }
    if (isDragging.current) {
      e.preventDefault()
      containerRef.current.scrollLeft = scrollLeft.current - walk
    }
  }

  const endDrag = () => {
    isPointerDown.current = false
    containerRef.current?.classList.remove('kanban-scroll--grabbing')
  }

  // Swallow the click that fires right after a drag so grabbing a header/button
  // to scroll doesn't also trigger that button's action.
  const onClickCapture = (e) => {
    if (isDragging.current) {
      e.preventDefault()
      e.stopPropagation()
      isDragging.current = false
    }
  }

  return (
    <div
      ref={containerRef}
      className="kanban-scroll overflow-x-auto pb-4"
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={endDrag}
      onMouseLeave={endDrag}
      onClickCapture={onClickCapture}
    >
      {children}
    </div>
  )
}

function KanbanTaskCard({ project, stageIndex, task, onOpenTask, onAddToToday }) {
  const taskOverdue = isOverdue(task.reminder_date) && !task.is_completed
  const visibleTags = task.tags || []

  return (
    <div
      role="button"
      tabIndex={0}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move'
        e.dataTransfer.setData('application/x-hypothesys-task', JSON.stringify({ projectId: project.id, stageIndex, taskId: task.id }))
      }}
      onClick={() => onOpenTask(project, task, stageIndex)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onOpenTask(project, task, stageIndex)
        }
      }}
      className={`group rounded-2xl border bg-white p-3 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-indigo-500/30 ${taskOverdue ? 'border-red-200 bg-red-50/70' : 'border-slate-200'}`}
      title="Click to open task"
    >
      <div className="flex items-start gap-3">
        <div className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${task.is_completed ? 'bg-emerald-100 text-emerald-600' : taskOverdue ? 'bg-red-100 text-red-600' : 'bg-slate-100 text-slate-500'}`}>
          {task.is_completed ? <Check className="w-4 h-4" /> : <FileText className="w-4 h-4" />}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            <div className={`min-w-0 flex-1 break-words text-sm font-semibold leading-5 ${task.is_completed ? 'line-through text-slate-400' : taskOverdue ? 'text-red-700' : 'text-slate-900'}`}>
              {task.title}
            </div>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onOpenTask(project, task, stageIndex)
              }}
              className="shrink-0 rounded-lg border border-slate-200 px-2 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-100"
              title="Open task"
            >
              Open
            </button>
          </div>

          {task.description && (
            <p className="mt-1 break-words text-xs leading-5 text-slate-500">
              {task.description}
            </p>
          )}

          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {task.reminder_date && (
              <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${taskOverdue ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>
                <Clock className="w-3 h-3" />
                {formatReminderDate(task.reminder_date)}
              </span>
            )}
            {task.subtasks?.length > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600">
                <MessageSquare className="w-3 h-3" />
                {task.subtasks.filter(subtask => !subtask.is_completed).length}/{task.subtasks.length} open
              </span>
            )}
            {visibleTags.map(tag => (
              <span
                key={tag.id}
                className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${tag.color === 'blue' ? 'bg-blue-100 text-blue-700' : tag.color === 'red' ? 'bg-red-100 text-red-700' : tag.color === 'green' ? 'bg-green-100 text-green-700' : tag.color === 'amber' ? 'bg-amber-100 text-amber-700' : tag.color === 'purple' ? 'bg-purple-100 text-purple-700' : 'bg-gray-100 text-gray-700'}`}
              >
                {tag.name}
              </span>
            ))}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1 self-start">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onAddToToday(task)
            }}
            className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-amber-50 hover:text-amber-500"
            title="Add to Tod(o)ay"
          >
            <Sun className="w-4 h-4" />
          </button>
          <ChevronRight className="w-4 h-4 shrink-0 text-gray-300" />
        </div>
      </div>
    </div>
  )
}

function KanbanStagePanel({ project, stage, stageIndex, isActive, onOpenTask, onAddToToday, onMoveTask }) {
  const [isExpanded, setIsExpanded] = useState(isActive)
  const [showCompleted, setShowCompleted] = useState(false)
  const [isDropTarget, setIsDropTarget] = useState(false)

  useEffect(() => {
    setIsExpanded(isActive)
    setShowCompleted(false)
  }, [project.id, stage.id, isActive])

  const activeTasks = useMemo(() => (stage.tasks || []).filter(task => !task.is_completed), [stage.tasks])
  const completedTasks = useMemo(() => (stage.tasks || []).filter(task => task.is_completed), [stage.tasks])

  const handleDrop = (e) => {
    e.preventDefault()
    setIsDropTarget(false)
    const raw = e.dataTransfer.getData('application/x-hypothesys-task')
    if (!raw || !onMoveTask) return
    try {
      const payload = JSON.parse(raw)
      onMoveTask({
        sourceProjectId: payload.projectId,
        sourceStageIndex: payload.stageIndex,
        taskId: payload.taskId,
        targetProjectId: project.id,
        targetStageIndex: stageIndex
      })
    } catch (error) {
      dwarn('Kanban drop failed', error)
    }
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white/90 shadow-sm">
      <button
        type="button"
        onClick={() => setIsExpanded(value => !value)}
        className={`flex w-full items-start justify-between gap-3 px-4 py-3 text-left transition-colors ${isExpanded ? 'bg-slate-50' : 'bg-white hover:bg-slate-50/70'}`}
        title={isExpanded ? 'Collapse stage' : 'Expand stage'}
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-semibold text-slate-900">{stage.name}</span>
            {isActive && <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-semibold text-indigo-700">Active</span>}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
            <span>{activeTasks.length} active</span>
            <span>{completedTasks.length} done</span>
          </div>
        </div>
        <div className="flex shrink-0 items-center text-slate-400" title={isExpanded ? 'Collapse' : 'Expand'}>
          {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </div>
      </button>

      {isExpanded && (
        <div
          className={`border-t border-slate-100 p-3 transition-colors ${isDropTarget ? 'bg-indigo-50/60' : ''}`}
          onDragOver={(e) => {
            e.preventDefault()
            setIsDropTarget(true)
          }}
          onDragLeave={() => setIsDropTarget(false)}
          onDrop={handleDrop}
        >
          <div className="space-y-2">
            {activeTasks.length > 0 ? (
              activeTasks.map(task => (
                <KanbanTaskCard
                  key={task.id}
                  project={project}
                  stageIndex={stageIndex}
                  task={task}
                  onOpenTask={onOpenTask}
                  onAddToToday={onAddToToday}
                />
              ))
            ) : (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-400">
                No active tasks in this stage.
              </div>
            )}
          </div>

          {completedTasks.length > 0 && (
            <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50/80">
              <button
                type="button"
                onClick={() => setShowCompleted(value => !value)}
                className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left"
                title={showCompleted ? 'Hide completed tasks' : 'Show completed tasks'}
              >
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-slate-500">{completedTasks.length} completed</span>
                </div>
                {showCompleted ? <ChevronDown className="w-3.5 h-3.5 text-slate-400" /> : <ChevronRight className="w-3.5 h-3.5 text-slate-400" />}
              </button>
              {showCompleted && (
                <div className="space-y-2 border-t border-slate-200 px-3 py-3">
                  {completedTasks.map(task => (
                    <KanbanTaskCard
                      key={task.id}
                      project={project}
                      stageIndex={stageIndex}
                      task={task}
                      onOpenTask={onOpenTask}
                      onAddToToday={onAddToToday}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  )
}

function KanbanProjectLane({ project, index, isSelectionMode, isSelected, onToggleSelect, onOpenProject, onOpenTask, onDelete, onDuplicate, onAddToToday, onMoveTask }) {
  const { user } = useAuth()
  const [showMenu, setShowMenu] = useState(false)
  const [showAllStages, setShowAllStages] = useState(false)

  const activeStageIndex = project.stages?.length ? Math.min(project.current_stage_index || 0, project.stages.length - 1) : 0
  const activeStageName = project.stages?.[activeStageIndex]?.name || 'No stage'
  const totalStages = project.stages?.length || 0

  const stats = useMemo(() => {
    const stages = project.stages || []
    const activeTasks = stages.reduce((acc, stage) => acc + (stage.tasks || []).filter(task => !task.is_completed).length, 0)
    const completedTasks = stages.reduce((acc, stage) => acc + (stage.tasks || []).filter(task => task.is_completed).length, 0)
    const overdueTasks = stages.reduce((acc, stage) => acc + (stage.tasks || []).filter(task => task.reminder_date && isOverdue(task.reminder_date) && !task.is_completed).length, 0)
    const projectProgress = getProgress(project)
    return { activeTasks, completedTasks, overdueTasks, projectProgress }
  }, [project])

  const isCollaborator = project.owner_id !== user?.id
  const hasMembers = project.project_members?.length > 0
  const isShared = isCollaborator || hasMembers

  return (
    <article
      className={`flex min-h-full min-w-[18rem] max-w-[22rem] flex-col rounded-[28px] border border-slate-200 bg-slate-50/80 p-3 shadow-sm backdrop-blur transition-all ${isSelected ? 'ring-2 ring-indigo-500/40' : ''}`}
      style={{ animationDelay: `${index * 45}ms` }}
    >
      <div className="flex items-start justify-between gap-3 rounded-[22px] border border-white/70 bg-white px-4 py-3 shadow-sm">
        <button
          type="button"
          onClick={() => {
            if (isSelectionMode) {
              onToggleSelect(project.id)
              return
            }
            onOpenProject(project)
          }}
          className="flex min-w-0 flex-1 items-start gap-3 text-left"
          title="Open project"
        >
          <span className="text-3xl">{project.emoji}</span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h3 className="truncate text-sm font-bold text-slate-900">{project.title}</h3>
              {isShared && (
                <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-semibold text-blue-700">
                  <Share2 className="w-3 h-3" />
                  Shared
                </span>
              )}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
              <span>{totalStages} stages</span>
              <span>{stats.activeTasks} active</span>
              <span>{stats.completedTasks} done</span>
            </div>
          </div>
        </button>

        <div className="flex shrink-0 items-start gap-1">
          {isSelectionMode && (
            <button
              type="button"
              onClick={() => onToggleSelect(project.id)}
              className={`mt-1 flex h-6 w-6 items-center justify-center rounded-md border text-xs ${isSelected ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-slate-300 bg-white text-slate-400'}`}
              title={isSelected ? 'Deselect project' : 'Select project'}
            >
              {isSelected ? <Check className="w-3.5 h-3.5" /> : null}
            </button>
          )}
          {!isSelectionMode && (
            <button
              type="button"
              onClick={() => setShowMenu(value => !value)}
              className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
              title="Project actions"
            >
              <MoreVertical className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Divider between project title and stage info */}
      <div className="my-2 mx-2 h-px bg-gradient-to-r from-transparent via-slate-200 to-transparent" />

      <div className="rounded-[22px] border border-slate-200 bg-white p-3 shadow-sm">
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400">Current stage</div>
            <div className="mt-1 text-sm font-semibold text-slate-900">{activeStageName}</div>
          </div>
          <button
            type="button"
            onClick={() => onOpenProject(project)}
            className="rounded-full bg-slate-100 px-3 py-1.5 text-[11px] font-semibold text-slate-600 transition-colors hover:bg-slate-200"
            title="Open project"
          >
            Open project
          </button>
        </div>

        <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
          <div className="h-full rounded-full bg-gradient-to-r from-slate-300 to-indigo-500" style={{ width: `${Math.max(4, Math.round(stats.projectProgress * 100))}%` }} />
        </div>
        <div className="mt-2 flex items-center justify-between text-[11px] text-slate-500">
          <span>{Math.round(stats.projectProgress * 100)}% complete</span>
          <span>{stats.overdueTasks} overdue</span>
        </div>
      </div>

      {/* Show only current stage by default; "View all stages" toggle for the rest */}
      <div className="mt-3 flex-1 space-y-3 overflow-y-auto pr-1">
        {/* Always show the active/current stage */}
        {project.stages?.[activeStageIndex] && (
          <KanbanStagePanel
            key={project.stages[activeStageIndex].id}
            project={project}
            stage={project.stages[activeStageIndex]}
            stageIndex={activeStageIndex}
            isActive={true}
            onOpenTask={onOpenTask}
            onAddToToday={onAddToToday}
            onMoveTask={onMoveTask}
          />
        )}

        {/* Other stages, toggled */}
        {showAllStages && (project.stages || []).map((stage, stageIndex) => {
          if (stageIndex === activeStageIndex) return null
          return (
            <KanbanStagePanel
              key={stage.id}
              project={project}
              stage={stage}
              stageIndex={stageIndex}
              isActive={false}
              onOpenTask={onOpenTask}
              onAddToToday={onAddToToday}
              onMoveTask={onMoveTask}
            />
          )
        })}

        {/* Toggle to show/hide other stages */}
        {totalStages > 1 && (
          <button
            type="button"
            onClick={() => setShowAllStages(v => !v)}
            className="flex w-full items-center justify-center gap-1.5 rounded-xl py-2 text-[11px] font-medium text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700"
            title={showAllStages ? 'Show only current stage' : `View all ${totalStages} stages`}
          >
            {showAllStages ? (
              <><ChevronUp className="w-3.5 h-3.5" /> Show less</>
            ) : (
              <><ChevronDown className="w-3.5 h-3.5" /> View all {totalStages} stages</>
            )}
          </button>
        )}
      </div>

      {showMenu && !isSelectionMode && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setShowMenu(false)} />
          <div className="absolute right-3 top-14 z-50 min-w-[160px] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
            <button
              type="button"
              onClick={() => {
                setShowMenu(false)
                onDuplicate(project)
              }}
              className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50"
            >
              <Copy className="w-4 h-4 text-slate-400" />
              Duplicate
            </button>
            <button
              type="button"
              onClick={() => {
                setShowMenu(false)
                onDelete(project.id)
              }}
              className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-red-600 hover:bg-red-50"
            >
              <Trash2 className="w-4 h-4" />
              Delete
            </button>
          </div>
        </>
      )}
    </article>
  )
}

// ============================================
// CREATE PROJECT MODAL
// ============================================
function CreateProjectModal({ onClose }) {
  const { projects, setProjects } = useApp()
  const { user, demoMode, profileReady } = useAuth()
  const [title, setTitle] = useState('')
  const [emoji, setEmoji] = useState('🧪')
  const [stages, setStages] = useState(['Ideation', 'Experiments', 'Analysis', 'Writing', 'Publication'])
  const [loading, setLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const [draggedIndex, setDraggedIndex] = useState(null)

  const handleDragStart = (e, index) => {
    setDraggedIndex(index)
    e.dataTransfer.effectAllowed = 'move'
  }

  const handleDragOver = (e) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }

  const handleDrop = (e, dropIndex) => {
    e.preventDefault()
    const dragIndex = draggedIndex
    if (dragIndex === null || dragIndex === dropIndex) return

    const newStages = [...stages]
    const [draggedItem] = newStages.splice(dragIndex, 1)
    newStages.splice(dropIndex, 0, draggedItem)
    setStages(newStages)
    setDraggedIndex(null)
  }

  const handleDragEnd = () => {
    setDraggedIndex(null)
  }

  const handleCreate = async () => {
    if (!title.trim() || stages.length === 0) return
    setLoading(true)
    setErrorMsg('')

    // New projects get lowest priority (highest number = added to end)
    const newPriorityRank = projects.length + 1
    const now = new Date().toISOString()

    const newProject = {
      id: uuid(),
      title: title.trim(),
      emoji,
      priority_rank: newPriorityRank,
      current_stage_index: 0,
      owner_id: user?.id || 'demo',
      created_at: now,
      updated_at: now,
      stages: stages.map((name, i) => ({
        id: uuid(),
        name,
        order_index: i,
        tasks: []
      })),
      project_members: []
    }

    if (demoMode) {
      setProjects([...projects, newProject])
      saveLocal([...projects, newProject])
    } else {
      // Check if user profile is ready (required for FK constraint)
      if (!profileReady) {
        setErrorMsg('User profile not ready. Please wait a moment and try again.')
        setLoading(false)
        return
      }

      // In real mode, create in Supabase
      dlog('📝 Creating project in Supabase...')
      const { data, error } = await db.createProject({
        title: newProject.title,
        emoji: newProject.emoji,
        priority_rank: newProject.priority_rank,
        current_stage_index: 0,
        owner_id: user.id
      })

      if (error || !data) {
        derr('❌ Create project failed:', error)
        setErrorMsg(error?.message || 'Failed to create project in Supabase.')
        setLoading(false)
        return
      }

      dlog('✅ Project created:', data.id)

      // Create stages
      for (const stage of newProject.stages) {
        const { error: stageError } = await db.createStage({
          project_id: data.id,
          name: stage.name,
          order_index: stage.order_index,
        })
        if (stageError) {
          derr('❌ Create stage failed:', stageError)
          setErrorMsg(stageError?.message || `Failed to create stage: ${stage.name}`)
          setLoading(false)
          return
        }
      }

      // Refresh projects
      const { data: refreshed, error: refreshError } = await db.getProjects(user.id)
      if (refreshError) {
        setErrorMsg(refreshError?.message || 'Project created, but failed to refresh projects.')
        setLoading(false)
        return
      }
      if (refreshed) setProjects(refreshed)
    }

    setLoading(false)
    onClose()
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="glass-card rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto animate-fade-in"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex justify-between items-center p-6 border-b border-gray-200">
          <h2 className="text-xl font-bold text-gray-900">New Project</h2>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg">
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {errorMsg && (
            <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl p-3">
              {errorMsg}
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Project Title</label>
            <input
              type="text"
              placeholder="Enter project title"
              value={title}
              onChange={e => setTitle(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && (e.shiftKey || title.trim())) {
                  handleCreate()
                }
              }}
              className="input-sleek"
              autoFocus
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Icon</label>
            <div className="grid grid-cols-8 gap-1">
              {EMOJIS.map(e => (
                <button
                  key={e}
                  onClick={() => setEmoji(e)}
                  className={`text-2xl p-2 rounded-lg transition-all ${emoji === e ? 'bg-brand-100 ring-2 ring-brand-500' : 'hover:bg-gray-100'
                    }`}
                >
                  {e}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Workflow Stages</label>
            <div className="space-y-2">
              {stages.map((stage, i) => (
                <div
                  key={i}
                  className={`flex gap-2 items-center p-2 rounded-lg border-2 transition-all ${draggedIndex === i ? 'border-brand-500 bg-brand-50 opacity-50' : 'border-transparent'
                    }`}
                  draggable
                  onDragStart={(e) => handleDragStart(e, i)}
                  onDragOver={handleDragOver}
                  onDrop={(e) => handleDrop(e, i)}
                  onDragEnd={handleDragEnd}
                >
                  <div className="cursor-move text-gray-400 mr-2">
                    <MoreVertical className="w-4 h-4" />
                  </div>
                  <input
                    type="text"
                    value={stage}
                    onChange={e => {
                      const newStages = [...stages]
                      newStages[i] = e.target.value
                      setStages(newStages)
                    }}
                    className="input-sleek flex-1"
                  />
                  <button
                    onClick={() => setStages(stages.filter((_, j) => j !== i))}
                    className="p-2 text-red-500 hover:bg-red-50 rounded-lg"
                    disabled={stages.length <= 1}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
              <button
                onClick={() => setStages([...stages, 'New Stage'])}
                className="w-full py-3 border-2 border-dashed border-gray-300 rounded-xl text-gray-500 hover:border-brand-500 hover:text-brand-600 transition-colors flex items-center justify-center gap-2"
              >
                <Plus className="w-4 h-4" />
                Add Stage
              </button>
            </div>
          </div>
        </div>

        <div className="flex gap-3 p-6 border-t border-gray-200">
          <button onClick={onClose} className="flex-1 py-3 px-4 border-2 border-gray-200 rounded-xl font-medium hover:bg-gray-50">
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={!title.trim() || stages.length === 0 || loading}
            className="flex-1 btn-gradient disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {loading && <Loader2 className="w-4 h-4 animate-spin" />}
            Create Project
          </button>
        </div>
      </div>
    </div>
  )
}

// ============================================
// PROJECT DETAIL VIEW
// ============================================
function ProjectDetail() {
  const { projects, setProjects, selectedProject, setSelectedProject, setView, setSelectedTask, addToToday, addSubtaskToToday, tags, createTag, editTag, deleteTag, assignTag, unassignTag, reorderTasks, reorderSubtasks, deletedTaskIdsRef } = useApp()
  const { demoMode, user } = useAuth()
  const currentUserName = user?.user_metadata?.name || user?.email || 'Unknown'
  const [previewIndex, setPreviewIndex] = useState(null)
  const [newTask, setNewTask] = useState('')
  const [showSettings, setShowSettings] = useState(false)
  const [showShare, setShowShare] = useState(false)
  const [activeTagPicker, setActiveTagPicker] = useState(null) // { taskId, subtaskId? }
  const dragTaskIndex = useRef(null)
  const dragSubtaskIndex = useRef(null)
  const dragSubtaskTaskId = useRef(null)

  const onTaskDragStart = (e, i) => { dragTaskIndex.current = i; e.dataTransfer?.setData('text/task', String(i)) }
  const onTaskDragOver = (e, i) => { e.preventDefault() }
  const onTaskDrop = (e, i) => {
    e.preventDefault()
    const from = dragTaskIndex.current ?? parseInt(e.dataTransfer?.getData('text/task') || '0', 10)
    if (from !== i) reorderTasks(project.id, stageIndex, from, i)
    dragTaskIndex.current = null
  }

  const onSubtaskDragStart = (e, taskId, i) => {
    dragSubtaskIndex.current = i;
    dragSubtaskTaskId.current = taskId;
    e.dataTransfer?.setData('text/subtask', String(i))
    e.stopPropagation()
  }
  const onSubtaskDragOver = (e, i) => { e.preventDefault(); e.stopPropagation() }
  const onSubtaskDrop = (e, taskId, i) => {
    e.preventDefault(); e.stopPropagation()
    if (dragSubtaskTaskId.current !== taskId) return
    const from = dragSubtaskIndex.current ?? parseInt(e.dataTransfer?.getData('text/subtask') || '0', 10)
    if (from !== i) reorderSubtasks(project.id, stageIndex, taskId, from, i)
    dragSubtaskIndex.current = null
    dragSubtaskTaskId.current = null
  }

  if (!selectedProject) return null

  const project = projects.find(p => p.id === selectedProject.id) || selectedProject
  const currentStageIndex = project.current_stage_index ?? 0
  const stageIndex = previewIndex ?? currentStageIndex
  const stage = project.stages?.[stageIndex]
  const progress = getProgress(project)
  // Show shared badge if: user is not owner (shared with them) OR project has members (owner has shared it)
  const isCollaborator = project.owner_id !== user?.id
  const hasMembers = project.project_members?.length > 0
  const isShared = isCollaborator || hasMembers

  const updateProject = (updated) => {
    const newProjects = projects.map(p => p.id === updated.id ? updated : p)
    setProjects(newProjects)
    setSelectedProject(updated)
    if (demoMode) saveLocal(newProjects)
  }

  const setCurrentStage = async (indexToSet = previewIndex) => {
    if (indexToSet === null || indexToSet === undefined) return
    const updated = { ...project, current_stage_index: indexToSet }
    updateProject(updated)
    if (!demoMode) await db.updateProject(project.id, { current_stage_index: indexToSet })
    setPreviewIndex(null)
  }

  const addTask = async () => {
    if (!newTask.trim()) return
    const now = new Date().toISOString()
    const localId = uuid()
    const userName = user?.user_metadata?.name || user?.email || 'Unknown'

    // Set order_index to 0 (top) and shift all other tasks down by 1
    const newTaskOrderIndex = 0
    const shiftedTasks = (stage?.tasks || []).map(t => ({
      ...t,
      order_index: (t.order_index || 0) + 1
    }))

    const task = {
      id: localId,
      title: newTask.trim(),
      description: '',
      is_completed: false,
      reminder_date: null,
      subtasks: [],
      comments: [],
      created_at: now,
      updated_at: now,
      is_local: true,
      created_by: user?.id,
      created_by_name: userName,
      modified_by: user?.id,
      modified_by_name: userName,
      order_index: newTaskOrderIndex
    }

    const updated = {
      ...project,
      updated_at: now,
      modified_by: user?.id,
      modified_by_name: userName,
      stages: project.stages.map((s, i) =>
        i === stageIndex ? { ...s, tasks: [task, ...shiftedTasks] } : s
      )
    }
    updateProject(updated)
    setNewTask('')

    if (!demoMode) {
      // Filter for valid DB columns only
      const cleanTask = {
        id: localId,
        stage_id: stage.id,
        title: task.title,
        description: task.description || '',
        order_index: newTaskOrderIndex,
        is_completed: false,
        reminder_date: task.reminder_date || null,
        created_by: user?.id,
        modified_by: user?.id
      }

      db.createTask(cleanTask).then(async ({ data: createdTask, error }) => {
        console.log('Task creation response:', { createdTask, error })
        if (error) {
          console.error('Failed to create task:', error)
          showToast('Failed to save task. Please try again.')
          // Remove the local task since it failed to save
          const rollbackProject = {
            ...project,
            stages: project.stages.map((s, i) =>
              i === stageIndex ? { ...s, tasks: s.tasks.filter(t => t.id !== localId) } : s
            )
          }
          updateProject(rollbackProject)
          return
        }
        // Task is already in local state with the correct ID.
        // We just mark it as no longer local.
        if (createdTask) {
          console.log('✅ Task saved to DB, syncing local state...');
          const syncProject = (p) => {
            if (p.id !== project.id) return p
            return {
              ...p,
              stages: p.stages.map(s =>
                s.id === stage.id
                  ? { ...s, tasks: s.tasks.map(t => t.id === localId ? { ...t, is_local: false } : t) }
                  : s
              ),
              updated_at: now,
              modified_by: user?.id,
              modified_by_name: userName
            }
          }

          setProjects(prev => {
            const next = prev.map(syncProject)
            return next
          })

          setSelectedProject(prev => {
            if (prev?.id === project.id) return syncProject(prev)
            return prev
          })

          // Notify collaborators about the new task
          if (isShared) {
            db.notifyCollaborators(project.id, user?.id, {
              type: 'task_created',
              title: 'New task added',
              message: task.title,
              task_id: localId
            })
          }
        }
      }).catch(err => {
        console.error('CRITICAL: Task creation failed to reach server:', err)
        showToast('Connection error. Task might not be saved.')
      })
    }
  }

  const toggleTask = async (taskId) => {
    const task = stage.tasks.find(t => t.id === taskId)
    if (!task) return

    const newIsCompleted = !task.is_completed
    const now = new Date().toISOString()

    // If completing the task, also complete all subtasks
    const updatedSubtasks = newIsCompleted && task.subtasks?.length > 0
      ? task.subtasks.map(s => ({ ...s, is_completed: true }))
      : task.subtasks

    const updated = {
      ...project,
      updated_at: now,
      stages: project.stages.map((s, i) =>
        i === stageIndex
          ? { ...s, tasks: s.tasks.map(t => t.id === taskId ? { ...t, is_completed: newIsCompleted, subtasks: updatedSubtasks, updated_at: now } : t) }
          : s
      )
    }
    updateProject(updated)

    if (!demoMode) {
      await db.updateTask(taskId, { is_completed: newIsCompleted, modified_by: user?.id })
      // Also update all subtasks in the database if completing parent
      if (newIsCompleted && task.subtasks?.length > 0) {
        for (const subtask of task.subtasks) {
          if (!subtask.is_completed) {
            await db.updateSubtask(subtask.id, { is_completed: true })
          }
        }
      }
    }
  }

  const deleteTask = async (taskId) => {
    // Guard: mark as deleted so realtime handler won't resurrect it
    deletedTaskIdsRef.current.add(taskId)

    const updated = {
      ...project,
      stages: project.stages.map((s, i) =>
        i === stageIndex ? { ...s, tasks: s.tasks.filter(t => t.id !== taskId) } : s
      )
    }
    updateProject(updated)

    if (!demoMode) {
      // Notify collaborators (exclude current user) then delete
      if (isShared) {
        await db.notifyCollaborators(project.id, user?.id, {
          type: 'task_deleted',
          title: 'Task deleted',
          message: `A task was deleted`,
          task_id: taskId
        })
      }
      await db.deleteTask(taskId)
    }

    // Cleanup guard after propagation delay
    setTimeout(() => deletedTaskIdsRef.current.delete(taskId), 8000)
  }

  const updateTaskReminder = async (taskId, reminderDate, scope = 'all') => {
    const now = new Date().toISOString()
    const userName = user?.user_metadata?.name || user?.email || 'Unknown'
    const task = stage.tasks.find(t => t.id === taskId)
    const updated = {
      ...project,
      stages: project.stages.map((s, i) =>
        i === stageIndex
          ? { ...s, tasks: s.tasks.map(t => t.id === taskId ? { ...t, reminder_date: reminderDate, updated_at: now, modified_by: user?.id, modified_by_name: userName } : t) }
          : s
      )
    }
    updateProject(updated)

    if (!demoMode) {
      await db.updateTask(taskId, { reminder_date: reminderDate, modified_by: user?.id })

      // Notify collaborators about the reminder only if scope === 'all'
      if (isShared && reminderDate && task && scope === 'all') {
        await db.notifyCollaborators(project.id, user?.id, {
          type: 'task_reminder_set',
          title: 'Reminder set on task',
          message: `${task.title} - ${formatReminderDate(reminderDate)}`,
          task_id: taskId
        })
      }
    }
  }

  const toggleSubtask = async (taskId, subtaskId) => {
    const task = stage.tasks.find(t => t.id === taskId)
    if (!task) return
    const subtask = task.subtasks?.find(s => s.id === subtaskId)
    if (!subtask) return

    const now = new Date().toISOString()
    const updated = {
      ...project,
      updated_at: now,
      stages: project.stages.map((s, i) =>
        i === stageIndex
          ? {
            ...s, tasks: s.tasks.map(t =>
              t.id === taskId
                ? { ...t, subtasks: t.subtasks.map(st => st.id === subtaskId ? { ...st, is_completed: !st.is_completed } : st), updated_at: now }
                : t
            )
          }
          : s
      )
    }
    updateProject(updated)

    if (!demoMode) {
      await db.updateSubtask(subtaskId, { is_completed: !subtask.is_completed })
    }
  }

  const updateSubtaskReminder = async (taskId, subtaskId, reminderDate, scope = 'all') => {
    const now = new Date().toISOString()
    const userName = user?.user_metadata?.name || user?.email || 'Unknown'
    const task = stage.tasks.find(t => t.id === taskId)
    const subtask = task?.subtasks?.find(s => s.id === subtaskId)
    const updated = {
      ...project,
      stages: project.stages.map((s, i) =>
        i === stageIndex
          ? {
            ...s, tasks: s.tasks.map(t =>
              t.id === taskId
                ? { ...t, subtasks: t.subtasks.map(st => st.id === subtaskId ? { ...st, reminder_date: reminderDate, updated_at: now, modified_by: user?.id, modified_by_name: userName } : st), updated_at: now }
                : t
            )
          }
          : s
      )
    }
    updateProject(updated)

    if (!demoMode) {
      await db.updateSubtask(subtaskId, { reminder_date: reminderDate, modified_by: user?.id })

      // Notify collaborators about the subtask reminder
      if (isShared && reminderDate && subtask) {
        await db.notifyCollaborators(project.id, user?.id, {
          type: 'subtask_reminder_set',
          title: 'Reminder set on subtask',
          message: `${subtask.title} - ${formatReminderDate(reminderDate)}`,
          task_id: taskId,
          subtask_id: subtaskId
        })
      }
    }
  }

  // Sort tasks: overdue first, then by reminder date, then others
  // Sort tasks: Completed at bottom, Newest active at top
  const sortedTasks = [...(stage?.tasks || [])].sort((a, b) => {
    if (a.is_completed !== b.is_completed) return a.is_completed ? 1 : -1
    if ((a.order_index || 0) !== (b.order_index || 0)) return (a.order_index || 0) - (b.order_index || 0)
    return new Date(b.created_at || 0) - new Date(a.created_at || 0)
  })

  // Multi-select state for tasks
  const [selectedTaskIds, setSelectedTaskIds] = React.useState(new Set())
  const [isSelectionMode, setIsSelectionMode] = React.useState(false)
  const lastSelectedIndex = React.useRef(null)

  const clearSelection = () => { setSelectedTaskIds(new Set()); setIsSelectionMode(false); lastSelectedIndex.current = null }

  const toggleSelect = (taskId, index, e, opts = {}) => {
    // Support shift-click selection
    const newSet = new Set(selectedTaskIds)
    if (opts.shift && lastSelectedIndex.current != null) {
      const start = Math.min(lastSelectedIndex.current, index)
      const end = Math.max(lastSelectedIndex.current, index)
      for (let i = start; i <= end; i++) {
        newSet.add(sortedTasks[i].id)
      }
    } else if (newSet.has(taskId)) {
      newSet.delete(taskId)
    } else {
      newSet.add(taskId)
    }
    setSelectedTaskIds(newSet)
    setIsSelectionMode(newSet.size > 0)
    lastSelectedIndex.current = index
  }

  // Long-press helper for mobile selection
  const longPressTimeout = React.useRef(null)
  const handleTouchStartSelect = (taskId, index) => {
    longPressTimeout.current = setTimeout(() => {
      toggleSelect(taskId, index, null)
    }, 500)
  }
  const handleTouchEndCancel = () => { if (longPressTimeout.current) { clearTimeout(longPressTimeout.current); longPressTimeout.current = null } }

  // Duplicate selected tasks (preserve subtasks). Performs local update and persists in background.
  const duplicateSelectedTasks = async () => {
    if (!sortedTasks || selectedTaskIds.size === 0) return
    const selectedIds = Array.from(selectedTaskIds)
    // Build clones
    const clones = []
    selectedIds.forEach(id => {
      const orig = sortedTasks.find(t => t.id === id)
      if (!orig) return
      const newTaskId = uuid()
      const newSubtasks = (orig.subtasks || []).map(s => ({ ...s, id: uuid(), created_at: new Date().toISOString() }))
      const clone = {
        ...orig,
        id: newTaskId,
        title: `${orig.title} (copy)`,
        is_completed: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        subtasks: newSubtasks
      }
      clones.push({ origId: id, clone })
    })

    // Insert clones after last selected task index to preserve order
    const indices = selectedIds.map(id => sortedTasks.findIndex(t => t.id === id)).filter(i => i >= 0).sort((a, b) => a - b)
    const insertAfter = indices.length ? indices[indices.length - 1] : sortedTasks.length - 1

    const newTasks = [...(stage.tasks || [])]
    // Insert clones after insertAfter in the stage.tasks array (map sortedTasks positions to actual positions)
    const baseIndex = insertAfter + 1
    newTasks.splice(baseIndex, 0, ...clones.map(c => c.clone))

    const updatedProject = {
      ...project,
      stages: project.stages.map((s, i) => i === stageIndex ? { ...s, tasks: newTasks } : s)
    }

    updateProject(updatedProject)

    // Persist clones in background
    if (!demoMode) {
      for (const c of clones) {
        try {
          const { data: created } = await db.createTask({ ...c.clone, stage_id: stage.id })
          // create subtasks if any
          if (created && c.clone.subtasks?.length) {
            for (const st of c.clone.subtasks) {
              await db.createSubtask({ ...st, task_id: created.id })
            }
          }
        } catch (e) {
          // swallow background errors (dev logs only)
          derr('Duplicate persist error', e)
        }
      }
    }

    // Clear selection after duplicate
    clearSelection()
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 pb-16">
      {/* Header */}
      <div className="bg-white/80 backdrop-blur-lg border-b border-gray-200 sticky top-16 z-30">
        <div className="max-w-5xl mx-auto px-3 sm:px-6 lg:px-8 py-3 sm:py-4">
          <div className="flex items-center gap-2 sm:gap-4">
            <button
              onClick={() => { setView('main'); setSelectedProject(null); }}
              className="p-2 hover:bg-gray-100 rounded-lg flex-shrink-0"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <span className="text-2xl sm:text-4xl">{project.emoji}</span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-lg sm:text-xl font-bold text-gray-900 truncate">{project.title}</h1>
                {isShared && (
                  <span className="tag bg-blue-100 text-blue-600 text-[9px]">
                    <Share2 className="w-2.5 h-2.5 mr-0.5" />
                    Shared
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                <span className="tag tag-default text-[10px] sm:text-[11px]">{project.stages?.[currentStageIndex]?.name}</span>
                <span className="text-xs sm:text-sm text-gray-500">{Math.round(progress * 100)}% complete</span>
              </div>
            </div>
            {/* Timestamps */}
            <div className="hidden md:flex flex-col items-end text-[10px] text-gray-400 mr-2">
              {project.created_at && (
                <span title={new Date(project.created_at).toLocaleString()}>
                  Created {formatRelativeDate(project.created_at)}
                </span>
              )}
              {getProjectLatestUpdatedAt(project) && getProjectLatestUpdatedAt(project) !== project.created_at && (
                <span title={new Date(getProjectLatestUpdatedAt(project)).toLocaleString()}>
                  Modified {formatModifiedBy(getProjectLatestUpdatedAt(project), project.modified_by_name, user?.user_metadata?.name || user?.email || 'Unknown')}
                </span>
              )}
            </div>
            <button onClick={() => setShowShare(true)} className="p-2 hover:bg-gray-100 rounded-lg">
              <Share2 className="w-5 h-5 text-gray-500" />
            </button>
            <button onClick={() => setShowSettings(true)} className="p-2 hover:bg-gray-100 rounded-lg">
              <Settings className="w-5 h-5 text-gray-500" />
            </button>
          </div>
        </div>
      </div>

      {/* Stage Selector */}
      <div className="bg-white/60 backdrop-blur-sm border-b border-gray-200">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="mb-3">
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Stages</span>
          </div>
          <div className="flex gap-2 overflow-x-auto pb-2">
            {project.stages?.map((s, i) => (
              <div key={s.id} className="flex flex-col items-center">
                <button
                  onClick={() => {
                    if (previewIndex === i && i !== currentStageIndex) {
                      // Second click on previewed non-current stage - set as current
                      setCurrentStage(i)
                    } else {
                      setPreviewIndex(i)
                    }
                  }}
                  className={`stage-pill ${i === currentStageIndex ? 'active' :
                    previewIndex === i ? 'preview' : ''
                    }`}
                >
                  {s.name}
                  {i === currentStageIndex && (
                    <span className="block text-[10px] opacity-70 mt-0.5">Current</span>
                  )}
                  {previewIndex === i && i !== currentStageIndex && (
                    <span className="block text-[10px] text-brand-600 font-semibold mt-0.5">Click to set current</span>
                  )}
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Tasks */}
      <div className="max-w-5xl mx-auto px-3 sm:px-6 lg:px-8 py-6 sm:py-8">
        <div className="mb-4 sm:mb-6 flex items-start justify-between">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">
            Tasks for {stage?.name}
          </h2>
          <div>
            {!isSelectionMode ? (
              <button
                onClick={() => { setIsSelectionMode(true); setSelectedTaskIds(new Set()) }}
                title="Select items"
                className="text-xs sm:text-sm px-3 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 flex items-center gap-2"
              >
                <Check className="w-4 h-4 text-gray-700" />
                <span className="text-gray-700">Select</span>
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <button onClick={() => setSelectedTaskIds(new Set(sortedTasks.map(t => t.id)))} className="text-xs sm:text-sm px-3 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200">Select all</button>
                <button onClick={() => clearSelection()} className="text-xs sm:text-sm px-3 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200">Clear</button>
                <button onClick={() => setIsSelectionMode(false)} className="text-xs sm:text-sm px-3 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200">Cancel</button>
              </div>
            )}
          </div>
        </div>

        {/* Add Task Input */}
        <div className="glass-card rounded-xl p-3 sm:p-4 mb-4 sm:mb-6 flex items-center gap-2 sm:gap-3">
          <Plus className="w-5 h-5 text-gray-400 flex-shrink-0" />
          <input
            type="text"
            placeholder="Add a new task..."
            value={newTask}
            onChange={e => setNewTask(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') addTask()
            }}
            className="flex-1 bg-transparent outline-none text-gray-900 placeholder-gray-400 min-w-0"
          />
          <button
            onClick={addTask}
            disabled={!newTask.trim()}
            className="w-8 h-8 rounded-full flex items-center justify-center text-white disabled:opacity-30 flex-shrink-0"
            style={{ background: 'linear-gradient(135deg, #e5e7eb, #4b5563)' }}
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>

        {/* Task List */}
        <div className="space-y-3">
          {/* Selection toolbar */}
          {isSelectionMode && (
            <div className="flex items-center justify-between p-3 bg-gray-50 rounded-xl">
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setSelectedTaskIds(new Set(sortedTasks.map(t => t.id)))}
                  className="text-sm text-brand-600 hover:underline"
                >
                  Select all
                </button>
                <button
                  onClick={() => clearSelection()}
                  className="text-sm text-gray-500 hover:underline"
                >
                  Clear
                </button>
                <span className="text-sm text-gray-600">{selectedTaskIds.size} selected</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={duplicateSelectedTasks}
                  className="px-3 py-1 rounded-lg bg-gray-800 text-white text-sm hover:bg-gray-700"
                >
                  Duplicate
                </button>
              </div>
            </div>
          )}
          {sortedTasks.length === 0 ? (
            <div className="text-center py-12 text-gray-400">
              No tasks yet. Add one above!
            </div>
          ) : (
            sortedTasks.map((task, i) => {
              const taskOverdue = isOverdue(task.reminder_date) && !task.is_completed
              const hasSubtasks = task.subtasks?.length > 0
              return (
                <div
                  key={task.id}
                  draggable="true"
                  onDragStart={(e) => onTaskDragStart(e, i)}
                  onDragOver={(e) => onTaskDragOver(e, i)}
                  onDrop={(e) => onTaskDrop(e, i)}
                  className={`glass-card glass-card-hover rounded-xl animate-fade-in transition-all ${taskOverdue ? 'bg-red-50/80 border-l-4 border-l-red-400' : ''
                    } relative group`}
                >
                  <div className="p-3 sm:p-4">
                    <div className="flex items-start gap-2 sm:gap-3">
                      <div className="flex items-center gap-1 sm:gap-2 mt-0.5">
                        {/* Drag Handle for Task */}
                        <div className="opacity-0 group-hover:opacity-40 transition-opacity p-0.5 -ml-1 cursor-grab active:cursor-grabbing text-gray-400 flex-shrink-0">
                          <GripVertical className="w-3.5 h-3.5" />
                        </div>

                        {isSelectionMode && (
                          <button
                            onMouseDown={() => { /* prevent text drag */ }}
                            onClick={(e) => { e.stopPropagation(); toggleSelect(task.id, i, e, { shift: e.shiftKey }) }}
                            onTouchStart={() => handleTouchStartSelect(task.id, i)}
                            onTouchEnd={() => handleTouchEndCancel()}
                            className={`w-5 h-5 rounded border flex items-center justify-center transition-colors flex-shrink-0 ${selectedTaskIds.has(task.id) ? 'bg-brand-600 border-brand-600 text-white' : 'border-gray-300 bg-white text-gray-400'}`}
                            title="Select task"
                          >
                            {selectedTaskIds.has(task.id) ? <Check className="w-3 h-3" /> : null}
                          </button>
                        )}

                        <button
                          onClick={() => toggleTask(task.id)}
                          className={`checkbox-custom flex-shrink-0 ${task.is_completed ? 'checked' : ''}`}
                        >
                          {task.is_completed && <Check className="w-3 h-3" />}
                        </button>
                      </div>
                      <div
                        className="flex-1 cursor-pointer min-w-0"
                        onClick={() => { setSelectedTask({ task, stageIndex }); setView('task'); }}
                      >
                        <div className={`font-medium ${task.is_completed ? 'line-through text-gray-400' : taskOverdue ? 'text-red-700' : 'text-gray-900'}`}>
                          {task.title}
                        </div>
                        {/* Tag Pills */}
                        {task.tags?.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1">
                            {task.tags.map(tag => {
                              const colorMap = {
                                blue: 'bg-blue-100 text-blue-700',
                                green: 'bg-green-100 text-green-700',
                                red: 'bg-red-100 text-red-700',
                                amber: 'bg-amber-100 text-amber-700',
                                purple: 'bg-purple-100 text-purple-700',
                                pink: 'bg-pink-100 text-pink-700',
                                indigo: 'bg-indigo-100 text-indigo-700',
                                gray: 'bg-gray-100 text-gray-700'
                              }
                              const colorClasses = colorMap[tag.color] || colorMap.blue
                              return (
                                <span key={tag.id} className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${colorClasses}`}>
                                  {tag.name}
                                </span>
                              )
                            })}
                          </div>
                        )}
                        <div className="flex items-center gap-2 sm:gap-4 mt-2 text-xs text-gray-400 flex-wrap">
                          {hasSubtasks && (
                            <span className="flex items-center gap-1">
                              <FileText className="w-3 h-3" />
                              {task.subtasks.filter(s => s.is_completed).length}/{task.subtasks.length}
                            </span>
                          )}
                          {task.comments?.length > 0 && (
                            <span className="flex items-center gap-1">
                              <MessageSquare className="w-3 h-3" />
                              {task.comments.length}
                            </span>
                          )}
                          {task.updated_at ? (
                            <span className="text-gray-300 hidden sm:inline" title={`Modified: ${new Date(task.updated_at).toLocaleString()}${task.modified_by_name ? ` by ${task.modified_by_name}` : ''}`}>
                              {formatRelativeDate(task.updated_at)}{isShared && task.modified_by_name && ` by ${task.modified_by === user?.id ? 'you' : task.modified_by_name}`}
                            </span>
                          ) : task.created_at && (
                            <span className="text-gray-300 hidden sm:inline" title={`Created: ${new Date(task.created_at).toLocaleString()}${task.created_by_name ? ` by ${task.created_by_name}` : ''}`}>
                              {formatRelativeDate(task.created_at)}{isShared && task.created_by_name && ` by ${task.created_by === user?.id ? 'you' : task.created_by_name}`}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        {/* Tag Button */}
                        <div className="relative">
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              if (activeTagPicker?.taskId === task.id && !activeTagPicker?.subtaskId) {
                                setActiveTagPicker(null)
                              } else {
                                const rect = e.currentTarget.getBoundingClientRect()
                                setActiveTagPicker({
                                  taskId: task.id,
                                  position: { top: rect.bottom + 8, right: window.innerWidth - rect.right }
                                })
                              }
                            }}
                            className={`p-2 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors ${activeTagPicker?.taskId === task.id && !activeTagPicker?.subtaskId ? 'bg-gray-100 text-gray-900' : ''}`}
                            title="Add Tag"
                          >
                            <Tag className="w-4 h-4" />
                          </button>
                          {activeTagPicker?.taskId === task.id && !activeTagPicker?.subtaskId && (
                            <TagPicker
                              tags={tags}
                              assignedTagIds={new Set((task.tags || []).map(t => t.id))}
                              onAssign={(tagId) => assignTag(task.id, tagId)}
                              onUnassign={(tagId) => unassignTag(task.id, tagId)}
                              onCreate={createTag}
                              onEdit={editTag}
                              onDelete={deleteTag}
                              onClose={() => setActiveTagPicker(null)}
                              position={activeTagPicker.position}
                            />
                          )}
                        </div>
                        <ReminderPicker
                          value={task.reminder_date}
                          onChange={(date, scope) => updateTaskReminder(task.id, date, scope)}
                          compact
                          isShared={isShared}
                        />
                        <button
                          onClick={(e) => { e.stopPropagation(); addToToday(task, { projectId: project.id }) }}
                          className="p-2 text-gray-400 hover:text-green-600 hover:bg-green-50 rounded-lg transition-colors"
                          title="Add to Tod(o)ay"
                        >
                          <Sun className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => deleteTask(task.id)}
                          className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Always visible Subtasks */}
                  {hasSubtasks && (
                    <div className="border-t border-gray-100 bg-gray-50/50 rounded-b-xl px-3 sm:px-4 py-2 space-y-1.5">
                      {[...(task.subtasks || [])].sort((a, b) => (a.is_completed ? 1 : 0) - (b.is_completed ? 1 : 0)).map((subtask, sIdx) => {
                        const subtaskOverdue = isOverdue(subtask.reminder_date) && !subtask.is_completed
                        const originalIdx = task.subtasks.findIndex(s => s.id === subtask.id)
                        return (
                          <div
                            key={subtask.id}
                            draggable="true"
                            onDragStart={(e) => onSubtaskDragStart(e, task.id, originalIdx)}
                            onDragOver={(e) => onSubtaskDragOver(e, sIdx)}
                            onDrop={(e) => onSubtaskDrop(e, task.id, sIdx)}
                            className={`flex items-center gap-2 py-1.5 px-2 rounded-lg ${subtaskOverdue ? 'bg-red-50' : ''} hover:bg-gray-100 group/subtask transition-colors relative`}
                          >
                            <div className="opacity-0 group-hover/subtask:opacity-40 p-0.5 -ml-1 text-gray-400 cursor-grab active:cursor-grabbing flex-shrink-0">
                              <GripVertical className="w-2.5 h-2.5" />
                            </div>
                            <button
                              onClick={() => toggleSubtask(task.id, subtask.id)}
                              className={`checkbox-custom flex-shrink-0 ${subtask.is_completed ? 'checked' : ''}`}
                              style={{ width: 16, height: 16 }}
                            >
                              {subtask.is_completed && <Check className="w-2.5 h-2.5" />}
                            </button>
                            <div className="flex-1 min-w-0 flex items-center gap-2">
                              <span className={`text-sm truncate ${subtask.is_completed ? 'line-through text-gray-400' : subtaskOverdue ? 'text-red-700' : 'text-gray-700'}`}>
                                {subtask.title}
                              </span>
                              {/* Subtask Tag Pills */}
                              {subtask.tags?.length > 0 && (
                                <div className="flex flex-wrap gap-1">
                                  {subtask.tags.map(tag => {
                                    const colorMap = {
                                      blue: 'bg-blue-100 text-blue-700',
                                      green: 'bg-green-100 text-green-700',
                                      red: 'bg-red-100 text-red-700',
                                      amber: 'bg-amber-100 text-amber-700',
                                      purple: 'bg-purple-100 text-purple-700',
                                      pink: 'bg-pink-100 text-pink-700',
                                      indigo: 'bg-indigo-100 text-indigo-700',
                                      gray: 'bg-gray-100 text-gray-700'
                                    }
                                    const colorClasses = colorMap[tag.color] || colorMap.blue
                                    return (
                                      <span key={tag.id} className={`px-1.5 py-0.5 rounded text-[9px] font-medium ${colorClasses}`}>
                                        {tag.name}
                                      </span>
                                    )
                                  })}
                                </div>
                              )}
                            </div>
                            {/* Subtask Tag Button */}
                            <div className="relative">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation()
                                  if (activeTagPicker?.subtaskId === subtask.id) {
                                    setActiveTagPicker(null)
                                  } else {
                                    const rect = e.currentTarget.getBoundingClientRect()
                                    setActiveTagPicker({
                                      taskId: task.id,
                                      subtaskId: subtask.id,
                                      position: { top: rect.bottom + 8, right: window.innerWidth - rect.right }
                                    })
                                  }
                                }}
                                className={`p-1 rounded hover:bg-gray-200 text-gray-400 hover:text-gray-600 transition-colors ${activeTagPicker?.subtaskId === subtask.id ? 'bg-gray-200 text-gray-900' : ''}`}
                                title="Add Tag"
                              >
                                <Tag className="w-3 h-3" />
                              </button>
                              {activeTagPicker?.subtaskId === subtask.id && (
                                <TagPicker
                                  tags={tags}
                                  assignedTagIds={new Set((subtask.tags || []).map(t => t.id))}
                                  onAssign={(tagId) => assignTag(task.id, tagId, subtask.id)}
                                  onUnassign={(tagId) => unassignTag(task.id, tagId, subtask.id)}
                                  onCreate={createTag}
                                  onEdit={editTag}
                                  onDelete={deleteTag}
                                  onClose={() => setActiveTagPicker(null)}
                                  position={activeTagPicker.position}
                                />
                              )}
                            </div>
                            <ReminderPicker
                              value={subtask.reminder_date}
                              onChange={(date, scope) => updateSubtaskReminder(task.id, subtask.id, date, scope)}
                              compact
                              isShared={isShared}
                            />
                            <button
                              onClick={(e) => { e.stopPropagation(); addSubtaskToToday(subtask, task, { projectId: project.id }) }}
                              className="p-2 text-gray-400 hover:text-green-600 hover:bg-green-50 rounded-lg transition-colors"
                              title="Add subtask to Tod(o)ay"
                            >
                              <Sun className="w-4 h-4" />
                            </button>
                          </div>
                        )
                      })}
                    </div>
                  )
                  }
                </div>
              )
            })
          )}
        </div>
      </div>

      {
        showSettings && (
          <ProjectSettingsModal
            project={project}
            onClose={() => setShowSettings(false)}
            onUpdate={updateProject}
            onDelete={async () => {
              if (!window.confirm('Delete this project and all its data?')) return
              if (demoMode) {
                const newProjects = projects.filter(p => p.id !== project.id)
                setProjects(newProjects)
                saveLocal(newProjects)
              } else {
                await db.deleteProject(project.id)
                setProjects(projects.filter(p => p.id !== project.id))
              }
              setSelectedProject(null)
              setView('main')
            }}
          />
        )
      }

      {
        showShare && (
          <ShareModal
            project={project}
            onClose={() => setShowShare(false)}
          />
        )
      }
    </div >
  )
}

// ============================================
// PROJECT SETTINGS MODAL
// ============================================
function ProjectSettingsModal({ project, onClose, onUpdate, onDelete }) {
  const { demoMode } = useAuth()
  const [title, setTitle] = useState(project.title)
  const [emoji, setEmoji] = useState(project.emoji)
  const [stages, setStages] = useState([...project.stages])
  const [loading, setLoading] = useState(false)
  const [draggedIndex, setDraggedIndex] = useState(null)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  const handleDragStart = (e, index) => {
    setDraggedIndex(index)
    e.dataTransfer.effectAllowed = 'move'
  }

  const handleDragOver = (e) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }

  const handleDrop = (e, dropIndex) => {
    e.preventDefault()
    const dragIndex = draggedIndex
    if (dragIndex === null || dragIndex === dropIndex) return

    const newStages = [...stages]
    const [draggedItem] = newStages.splice(dragIndex, 1)
    newStages.splice(dropIndex, 0, draggedItem)
    setStages(newStages)
    setDraggedIndex(null)
  }

  const handleDragEnd = () => {
    setDraggedIndex(null)
  }

  const handleSave = async () => {
    setLoading(true)
    // Update order_index for all stages based on current order
    const updatedStages = stages.map((stage, index) => ({
      ...stage,
      order_index: index
    }))

    // Find the new index of the stage that was previously current
    // We track by stage ID to maintain the current stage even after reordering
    const previousCurrentStage = project.stages[project.current_stage_index ?? 0]
    let newCurrentStageIndex = updatedStages.findIndex(s => s.id === previousCurrentStage?.id)
    if (newCurrentStageIndex === -1) {
      // If the current stage was deleted, default to 0
      newCurrentStageIndex = 0
    }

    const updated = {
      ...project,
      title,
      emoji,
      stages: updatedStages,
      current_stage_index: newCurrentStageIndex
    }
    onUpdate(updated)

    if (!demoMode) {
      // 1. Update project metadata
      await db.updateProject(project.id, { title, emoji, current_stage_index: newCurrentStageIndex })

      // 2. Sync Stages
      const originalStages = project.stages || []
      const originalIds = originalStages.map(s => s.id)
      const currentIds = updatedStages.map(s => s.id)

      // Deletions
      const deletedIds = originalIds.filter(id => !currentIds.includes(id))
      for (const id of deletedIds) {
        await db.deleteStage(id)
      }

      // Additions & Updates
      for (const s of updatedStages) {
        if (originalIds.includes(s.id)) {
          // Existing stage - check for changes (name or order)
          const original = originalStages.find(os => os.id === s.id)
          if (original.name !== s.name || original.order_index !== s.order_index) {
            await db.updateStage(s.id, { name: s.name, order_index: s.order_index })
          }
        } else {
          // New stage - create it
          await db.createStage({
            id: s.id, // Use valid UUID generated locally by uuid()
            project_id: project.id,
            name: s.name,
            order_index: s.order_index
          })
        }
      }
    }

    setLoading(false)
    onClose()
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && e.shiftKey) {
      e.preventDefault();
      handleSave();
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="glass-card rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto animate-fade-in"
        onClick={e => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <div className="flex justify-between items-center p-6 border-b border-gray-200">
          <h2 className="text-xl font-bold text-gray-900">Project Settings</h2>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg">
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Title</label>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              className="input-sleek"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Icon</label>
            <div className="grid grid-cols-8 gap-1">
              {EMOJIS.map(e => (
                <button
                  key={e}
                  onClick={() => setEmoji(e)}
                  className={`text-2xl p-2 rounded-lg transition-all ${emoji === e ? 'bg-brand-100 ring-2 ring-brand-500' : 'hover:bg-gray-100'
                    }`}
                >
                  {e}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Stages</label>
            <div className="space-y-2">
              {stages.map((stage, i) => (
                <div
                  key={stage.id}
                  className={`flex gap-2 items-center p-2 rounded-lg border-2 transition-all ${draggedIndex === i ? 'border-brand-500 bg-brand-50 opacity-50' : 'border-transparent'
                    }`}
                  draggable
                  onDragStart={(e) => handleDragStart(e, i)}
                  onDragOver={handleDragOver}
                  onDrop={(e) => handleDrop(e, i)}
                  onDragEnd={handleDragEnd}
                >
                  <div className="cursor-move text-gray-400 mr-2">
                    <MoreVertical className="w-4 h-4" />
                  </div>
                  <input
                    type="text"
                    value={stage.name}
                    onChange={e => {
                      const newStages = [...stages]
                      newStages[i] = { ...newStages[i], name: e.target.value }
                      setStages(newStages)
                    }}
                    className="input-sleek flex-1"
                  />
                  {stages.length > 1 && (
                    <button
                      onClick={() => setStages(stages.filter((_, j) => j !== i))}
                      className="p-2 text-red-500 hover:bg-red-50 rounded-lg"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              ))}
              <button
                onClick={() => setStages([...stages, { id: uuid(), name: 'New Stage', tasks: [] }])}
                className="w-full py-3 border-2 border-dashed border-gray-300 rounded-xl text-gray-500 hover:border-brand-500 hover:text-brand-600 transition-colors flex items-center justify-center gap-2"
              >
                <Plus className="w-4 h-4" />
                Add Stage
              </button>
            </div>
          </div>

        </div>

        <div className="flex gap-3 p-6 border-t border-gray-200">
          <button onClick={onClose} className="flex-1 py-3 px-4 border-2 border-gray-200 rounded-xl font-medium hover:bg-gray-50">
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={loading}
            className="flex-1 btn-gradient flex items-center justify-center gap-2"
          >
            {loading && <Loader2 className="w-4 h-4 animate-spin" />}
            Save Changes
          </button>
        </div>

        {/* Danger Zone - Below buttons */}
        <div className="px-6 pb-6">
          {!showDeleteConfirm ? (
            <button
              onClick={() => setShowDeleteConfirm(true)}
              className="w-full py-3 px-4 border-2 border-red-200 text-red-600 rounded-xl font-medium hover:bg-red-50 flex items-center justify-center gap-2"
            >
              <Trash2 className="w-4 h-4" />
              Delete Project
            </button>
          ) : (
            <div className="bg-red-50 border-2 border-red-200 rounded-xl p-4">
              <p className="text-sm text-red-700 mb-3 text-center">
                Are you sure you want to delete <strong>{project.title}</strong>? This action cannot be undone.
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setShowDeleteConfirm(false)}
                  className="flex-1 py-2 px-4 border border-gray-300 rounded-lg text-gray-700 hover:bg-white"
                >
                  Cancel
                </button>
                <button
                  onClick={() => { onClose(); onDelete(); }}
                  className="flex-1 py-2 px-4 bg-red-600 text-white rounded-lg font-medium hover:bg-red-700"
                >
                  Yes, Delete
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ============================================
// SHARE MODAL
// ============================================
function ShareModal({ project, onClose, onUpdate }) {
  const { demoMode, user } = useAuth()
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [inviteLink, setInviteLink] = useState('')
  const [members, setMembers] = useState(project.project_members || [])
  const [pendingInvites, setPendingInvites] = useState([])
  const [loadingInvites, setLoadingInvites] = useState(true)

  // Load pending invitations
  useEffect(() => {
    const loadInvites = async () => {
      if (demoMode) {
        setLoadingInvites(false)
        return
      }
      const { data } = await db.getProjectInvitations(project.id)
      setPendingInvites(data || [])
      setLoadingInvites(false)
    }
    loadInvites()
  }, [project.id, demoMode])

  const handleShare = async () => {
    if (!email.trim()) return
    setLoading(true)
    setError('')
    setSuccess('')
    setInviteLink('')

    if (demoMode) {
      setError('Sharing requires Supabase to be configured')
      setLoading(false)
      return
    }

    const result = await db.shareProject(project.id, email.trim(), 'editor', user?.id)

    if (result.error) {
      setError(result.error.message || 'Failed to share project')
    } else if (result.type === 'invited') {
      // User doesn't exist - invitation created
      const link = `${window.location.origin}?invite=${result.data.token}`
      setInviteLink(link)
      setSuccess(`${email} hasn't joined HypotheSys™ yet. Share the invite link below to give them access!`)
      setPendingInvites(prev => [...prev, result.data])
      setEmail('')
    } else if (result.type === 'existing') {
      // Invitation already exists - show the link again
      const link = `${window.location.origin}?invite=${result.data.token}`
      setInviteLink(link)
      setSuccess(result.message || `Invitation already sent! Here's the link:`)
      setEmail('')
    } else {
      // User exists - added directly
      setSuccess(`${email} has been added to the project!`)
      setEmail('')
      if (result.data) {
        setMembers(prev => [...prev, result.data])
      }
    }
    setLoading(false)
  }

  const handleCopyLink = () => {
    navigator.clipboard.writeText(inviteLink)
    setSuccess('Invite link copied to clipboard!')
  }

  const handleCancelInvite = async (inviteId) => {
    const { error } = await db.cancelInvitation(inviteId)
    if (!error) {
      setPendingInvites(prev => prev.filter(i => i.id !== inviteId))
    }
  }

  const handleRemoveMember = async (userId) => {
    if (demoMode) return

    const { error } = await db.removeProjectMember(project.id, userId)
    if (!error) {
      setMembers(prev => prev.filter(m => m.user_id !== userId))
    }
  }

  const isOwner = project.owner_id === user?.id

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="glass-card rounded-2xl w-full max-w-md animate-fade-in max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex justify-between items-center p-6 border-b border-gray-200 sticky top-0 bg-white/90 backdrop-blur">
          <h2 className="text-xl font-bold text-gray-900">Share Project</h2>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg">
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        <div className="p-6">
          <p className="text-gray-500 text-sm mb-4">
            Invite collaborators to work on "{project.title}" with you. You can invite anyone by email, even if they don't have an account yet.
          </p>

          {isOwner && (
            <div className="flex gap-2 mb-4">
              <div className="relative flex-1">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="email"
                  placeholder="Enter email address"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') handleShare()
                  }}
                  className="input-sleek pl-10"
                />
              </div>
              <button
                onClick={handleShare}
                disabled={!email.trim() || loading}
                className="btn-gradient flex items-center gap-2"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
                Invite
              </button>
            </div>
          )}

          {!isOwner && (
            <p className="text-sm text-amber-600 bg-amber-50 rounded-lg p-3 mb-4">
              Only the project owner can invite new members.
            </p>
          )}

          {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg p-3 mb-4">{error}</p>}
          {success && <p className="text-sm text-green-600 bg-green-50 rounded-lg p-3 mb-4">{success}</p>}

          {inviteLink && (
            <div className="bg-blue-50 rounded-lg p-4 mb-4">
              <p className="text-sm text-blue-800 font-medium mb-2">📧 Share this invite link:</p>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={inviteLink}
                  readOnly
                  className="input-sleek text-xs flex-1 bg-white"
                />
                <button
                  onClick={handleCopyLink}
                  className="px-3 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 flex items-center gap-1"
                >
                  <Copy className="w-3 h-3" />
                  Copy
                </button>
              </div>
              <p className="text-xs text-blue-600 mt-2">
                When they sign in with this link, they'll automatically join the project.
              </p>
            </div>
          )}

          {/* Pending Invitations */}
          {pendingInvites.length > 0 && (
            <div className="mb-4">
              <h3 className="text-sm font-semibold text-gray-700 mb-2">Pending Invitations</h3>
              <div className="space-y-2">
                {pendingInvites.map(invite => (
                  <div key={invite.id} className="flex items-center justify-between p-3 bg-amber-50 rounded-lg">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-amber-200 flex items-center justify-center text-amber-700 text-xs">
                        ✉️
                      </div>
                      <div>
                        <div className="font-medium text-sm text-gray-900">{invite.email}</div>
                        <div className="text-xs text-amber-600">Pending invite</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => {
                          const link = `${window.location.origin}?invite=${invite.token}`
                          navigator.clipboard.writeText(link)
                          setSuccess('Invite link copied!')
                          setTimeout(() => setSuccess(''), 2000)
                        }}
                        className="p-1.5 hover:bg-amber-100 rounded text-amber-600 hover:text-amber-700"
                        title="Copy invite link"
                      >
                        <Copy className="w-4 h-4" />
                      </button>
                      {isOwner && (
                        <button
                          onClick={() => handleCancelInvite(invite.id)}
                          className="p-1.5 hover:bg-amber-100 rounded text-gray-400 hover:text-red-500"
                          title="Cancel invitation"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="mt-4">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">Team</h3>
            <div className="space-y-2">
              {/* Show owner first */}
              <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                <div className="flex items-center gap-3">
                  <div className="avatar text-xs bg-gradient-to-br from-gray-400 to-gray-600">
                    {user?.user_metadata?.name?.[0] || user?.email?.[0] || 'O'}
                  </div>
                  <div>
                    <div className="font-medium text-sm">
                      {project.owner_id === user?.id ? 'You' : 'Owner'}
                    </div>
                    <div className="text-xs text-gray-500">Owner</div>
                  </div>
                </div>
              </div>

              {/* Show members */}
              {members.map(member => (
                <div key={member.user_id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                  <div className="flex items-center gap-3">
                    <div className="avatar text-xs">
                      {member.user?.name?.[0] || member.user?.email?.[0] || '?'}
                    </div>
                    <div>
                      <div className="font-medium text-sm">
                        {member.user?.name || member.user?.email || 'Unknown'}
                        {member.user_id === user?.id && ' (You)'}
                      </div>
                      <div className="text-xs text-gray-500 capitalize">{member.role}</div>
                    </div>
                  </div>
                  {isOwner && member.user_id !== user?.id && (
                    <button
                      onClick={() => handleRemoveMember(member.user_id)}
                      className="p-1 hover:bg-gray-200 rounded text-gray-400 hover:text-red-500"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ============================================
// TASK DETAIL VIEW
// ============================================
function TaskDetail() {
  const {
    projects, setProjects, selectedProject, setSelectedProject, selectedTask, setSelectedTask, setView, addToToday, addSubtaskToToday,
    tags, activeTagPicker, setActiveTagPicker, assignTag, unassignTag, createTag, editTag, deleteTag, reorderSubtasks,
    showToast, deletedTaskIdsRef
  } = useApp()
  const { demoMode, user } = useAuth()
  const [newSubtask, setNewSubtask] = useState('')
  const [newComment, setNewComment] = useState('')
  const [isSubtaskSelectionMode, setIsSubtaskSelectionMode] = useState(false)
  const [selectedSubtaskIds, setSelectedSubtaskIds] = useState(new Set())
  const [editingSubtaskId, setEditingSubtaskId] = useState(null)
  const [editingSubtaskTitle, setEditingSubtaskTitle] = useState('')
  const [isEditingTitle, setIsEditingTitle] = useState(false)
  const [localTitle, setLocalTitle] = useState(selectedTask?.task?.title || '')
  const dragSubtaskIndex = useRef(null)

  const onSubtaskDragStart = (e, i) => {
    dragSubtaskIndex.current = i
    e.dataTransfer?.setData('text/subtask', String(i))
  }
  const onSubtaskDragOver = (e) => { e.preventDefault() }
  const onSubtaskDrop = (e, i) => {
    e.preventDefault()
    const from = dragSubtaskIndex.current ?? parseInt(e.dataTransfer?.getData('text/subtask') || '0', 10)
    if (from !== i) {
      reorderSubtasks(project.id, stageIndex, currentTask.id, from, i)
    }
    dragSubtaskIndex.current = null
  }

  if (!selectedTask || !selectedProject) return null

  const project = projects.find(p => p.id === selectedProject.id)
  if (!project) return null

  const { task, stageIndex } = selectedTask
  const currentTask = project.stages[stageIndex]?.tasks?.find(t => t.id === task.id)
  const stage = project.stages[stageIndex]
  if (!currentTask) return null

  const taskOverdue = isOverdue(currentTask.reminder_date) && !currentTask.is_completed
  const isCollaborator = project.owner_id !== user?.id
  const hasMembers = project.project_members?.length > 0
  const isShared = isCollaborator || hasMembers
  const userName = user?.user_metadata?.name || user?.email || 'Unknown'

  const updateTask = (updates) => {
    const now = new Date().toISOString()
    const updated = {
      ...project,
      updated_at: now,
      modified_by: user?.id,
      modified_by_name: userName,
      stages: project.stages.map((s, i) =>
        i === stageIndex
          ? { ...s, tasks: s.tasks.map(t => t.id === task.id ? { ...t, ...updates, updated_at: now, modified_by: user?.id, modified_by_name: userName } : t) }
          : s
      )
    }
    const newProjects = projects.map(p => p.id === project.id ? updated : p)
    setProjects(newProjects)
    if (demoMode) saveLocal(newProjects)
  }

  const toggleTaskCompletion = async () => {
    const newIsCompleted = !currentTask.is_completed

    // If completing the task, also complete all subtasks
    const updatedSubtasks = newIsCompleted && currentTask.subtasks?.length > 0
      ? currentTask.subtasks.map(s => ({ ...s, is_completed: true }))
      : currentTask.subtasks

    updateTask({ is_completed: newIsCompleted, subtasks: updatedSubtasks })

    if (!demoMode) {
      await db.updateTask(task.id, { is_completed: newIsCompleted, modified_by: user?.id })
      // Also update all subtasks in the database if completing parent
      if (newIsCompleted && currentTask.subtasks?.length > 0) {
        for (const subtask of currentTask.subtasks) {
          if (!subtask.is_completed) {
            await db.updateSubtask(subtask.id, { is_completed: true })
          }
        }
      }
    }
  }

  const updateTaskReminder = async (reminderDate, scope = 'all') => {
    updateTask({ reminder_date: reminderDate })
    if (!demoMode) {
      await db.updateTask(task.id, { reminder_date: reminderDate, modified_by: user?.id })

      // Notify collaborators about the reminder only if scope === 'all'
      if (isShared && reminderDate && scope === 'all') {
        await db.notifyCollaborators(project.id, user?.id, {
          type: 'task_reminder_set',
          title: 'Reminder set on task',
          message: `${currentTask.title} - ${formatReminderDate(reminderDate)}`,
          task_id: task.id
        })
      }
    }
  }

  // Local description state for robust saving
  const [localDescription, setLocalDescription] = useState(currentTask?.description || '')

  // Sync local description when currentTask changes (e.g. switching tasks)
  useEffect(() => {
    setLocalDescription(currentTask?.description || '')
    setLocalTitle(currentTask?.title || '')
    setIsEditingTitle(false)
  }, [currentTask?.id, currentTask?.description, currentTask?.title])

  const [isEditingDescription, setIsEditingDescription] = useState(false)

  const saveDescription = async () => {
    if (localDescription !== currentTask.description) {
      updateTask({ description: localDescription })
      if (!demoMode) {
        try {
          const { error } = await db.updateTask(task.id, { description: localDescription, modified_by: user?.id, updated_at: new Date().toISOString() })
          if (error) {
            console.warn('Failed to save description', error)
          }
        } catch (e) {
          console.warn('Failed to save description', e)
        }
      }
    }
    setIsEditingDescription(false)
  }

  const saveTitle = async () => {
    const trimmed = localTitle.trim()
    if (!trimmed) {
      setLocalTitle(currentTask.title)
      setIsEditingTitle(false)
      return
    }

    if (trimmed !== currentTask.title) {
      updateTask({ title: trimmed })
      if (!demoMode) {
        try {
          const { error } = await db.updateTask(task.id, { title: trimmed, modified_by: user?.id, updated_at: new Date().toISOString() })
          if (error) {
            console.warn('Failed to save title', error)
            showToast('Failed to save title')
          } else {
            // refresh local projects to reflect updated title
            try { await reloadProjects() } catch (e) { }
          }
        } catch (e) {
          console.warn('Failed to save title', e)
        }
      }
    }
    setIsEditingTitle(false)
  }

  const cancelTitleEdit = () => {
    setLocalTitle(currentTask.title)
    setIsEditingTitle(false)
  }

  const cancelDescriptionEdit = () => {
    setLocalDescription(currentTask?.description || '')
    setIsEditingDescription(false)
  }

  const toggleSubtaskSelection = (subtaskId, e) => {
    e?.stopPropagation()
    const newSelected = new Set(selectedSubtaskIds)
    if (newSelected.has(subtaskId)) {
      newSelected.delete(subtaskId)
    } else {
      newSelected.add(subtaskId)
    }
    setSelectedSubtaskIds(newSelected)
  }

  const selectAllSubtasks = () => {
    if (selectedSubtaskIds.size === (currentTask.subtasks?.length || 0)) {
      setSelectedSubtaskIds(new Set())
    } else {
      setSelectedSubtaskIds(new Set(currentTask.subtasks?.map(s => s.id) || []))
    }
  }

  const handleBulkDeleteSubtasks = async () => {
    if (selectedSubtaskIds.size === 0) return
    if (!window.confirm(`Delete ${selectedSubtaskIds.size} subtask(s)?`)) return

    const remaining = currentTask.subtasks.filter(s => !selectedSubtaskIds.has(s.id))
    updateTask({ subtasks: remaining })

    if (!demoMode) {
      for (const subtaskId of selectedSubtaskIds) {
        await db.deleteSubtask(subtaskId)
      }
    }

    setSelectedSubtaskIds(new Set())
    setIsSubtaskSelectionMode(false)
  }

  const [editingCommentId, setEditingCommentId] = useState(null)
  const [editingCommentContent, setEditingCommentContent] = useState('')

  const startEditingComment = (comment) => {
    setEditingCommentId(comment.id)
    setEditingCommentContent(comment.content)
  }

  const saveCommentEdit = async (commentId) => {
    if (!editingCommentContent.trim()) return
    const now = new Date().toISOString()
    const updatedComments = currentTask.comments.map(c =>
      c.id === commentId
        ? { ...c, content: editingCommentContent, updated_at: now }
        : c
    )
    updateTask({ comments: updatedComments })
    setEditingCommentId(null)

    if (!demoMode) {
      await db.updateComment(commentId, { content: editingCommentContent, updated_at: now })
    }
  }

  const deleteComment = async (commentId) => {
    if (!window.confirm('Delete this comment?')) return
    const updatedComments = currentTask.comments.filter(c => c.id !== commentId)
    updateTask({ comments: updatedComments })
    if (!demoMode) await db.deleteComment(commentId)
  }

  const addSubtask = async () => {
    if (!newSubtask.trim()) return
    const localId = uuid()
    const now = new Date().toISOString()

    // Set order_index to 0 (top) and shift all other subtasks down by 1
    const newSubtaskOrderIndex = 0
    const shiftedSubtasks = (currentTask.subtasks || []).map(st => ({
      ...st,
      order_index: (st.order_index || 0) + 1
    }))

    const subtask = {
      id: localId,
      title: newSubtask.trim(),
      is_completed: false,
      reminder_date: null,
      created_by: user?.id,
      created_by_name: userName,
      modified_by: user?.id,
      modified_by_name: userName,
      created_at: now,
      updated_at: now,
      order_index: newSubtaskOrderIndex
    }
    updateTask({ subtasks: [subtask, ...shiftedSubtasks] })
    setNewSubtask('')

    if (!demoMode) {
      // Filter for valid DB columns only
      console.log('📝 Attempting to save subtask with task_id:', currentTask.id);

      // NOTE: Don't pass 'id' - let Supabase auto-generate it
      // Then we'll update local state with the actual ID from the response
      const cleanSubtask = {
        task_id: currentTask.id,
        title: subtask.title,
        is_completed: false,
        order_index: newSubtaskOrderIndex,
        created_by: user ? user.id : null,
        modified_by: user ? user.id : null
      }

      console.log('📝 Saving subtask to DB object (NO local ID):', cleanSubtask);

      db.createSubtask(cleanSubtask).then(async ({ data: createdSubtask, error }) => {

        if (error) {
          console.error('Failed to create subtask:', error)
          showToast('Failed to save subtask. Please try again.')
          // Remove the local subtask since it failed to save
          updateTask({ subtasks: currentTask.subtasks.filter(st => st.id !== localId) })
          return
        }
        // Update local state - NOW use the actual ID from the database response
        if (createdSubtask) {
          console.log('✅ Subtask saved to DB with REAL ID:', createdSubtask.id);
          const now = new Date().toISOString()
          const syncSubtaskProject = (p) => {
            if (p.id !== project.id) return p
            return {
              ...p,
              updated_at: now,
              modified_by: user?.id,
              modified_by_name: userName,
              stages: p.stages.map(s =>
                s.id === stage.id
                  ? {
                    ...s, tasks: s.tasks.map(t => t.id === task.id
                      ? { ...t, subtasks: t.subtasks.map(st => st.id === localId ? { ...st, id: createdSubtask.id, is_local: false } : st) }
                      : t
                    )
                  }
                  : s
              )
            }
          }

          // Sync local state with real ID
          setProjects(prev => prev.map(syncSubtaskProject))
          if (selectedProject?.id === project.id) {
            setSelectedProject(prev => syncSubtaskProject(prev))
          }

          // Persist ordering so the new subtask stays at the top after reload
          const updatedSubtasks = (currentTask.subtasks || []).map(st =>
            st.id === localId ? { ...st, id: createdSubtask.id, is_local: false } : st
          )
          const orderUpdates = updatedSubtasks.map((st, idx) => ({ id: st.id, order_index: idx }))
          db.bulkUpdateSubtasks(orderUpdates).catch(err => console.warn('subtask order sync failed', err))

          // Notify collaborators about the new subtask
          if (isShared) {
            db.notifyCollaborators(project.id, user?.id, {
              type: 'subtask_created',
              title: 'New subtask added',
              message: `${currentTask.title} → ${subtask.title}`,
              task_id: task.id,
              subtask_id: createdSubtask.id
            })
          }
        }
      }).catch(err => {
        console.error('CRITICAL: Subtask creation failed to reach server:', err)
        showToast('Connection error. Subtask might not be saved.')
      })
    }
  }

  const updateSubtaskTitle = async (subtaskId, newTitle) => {
    const subtask = currentTask.subtasks?.find(s => s.id === subtaskId)
    if (!subtask || subtask.title === newTitle) {
      setEditingSubtaskId(null)
      return
    }

    updateTask({
      subtasks: currentTask.subtasks.map(s =>
        s.id === subtaskId ? { ...s, title: newTitle, updated_at: new Date().toISOString() } : s
      )
    })

    if (!demoMode) {
      await db.updateSubtask(subtaskId, { title: newTitle })
    }
    setEditingSubtaskId(null)
  }

  const toggleSubtask = async (subtaskId) => {
    const subtask = currentTask.subtasks?.find(s => s.id === subtaskId)
    updateTask({
      subtasks: currentTask.subtasks.map(s =>
        s.id === subtaskId ? { ...s, is_completed: !s.is_completed, updated_at: new Date().toISOString() } : s
      )
    })

    if (!demoMode) {
      await db.updateSubtask(subtaskId, { is_completed: !subtask.is_completed })
    }
  }

  const updateSubtaskReminder = async (subtaskId, reminderDate, scope = 'all') => {
    const subtask = currentTask.subtasks?.find(s => s.id === subtaskId)
    updateTask({
      subtasks: currentTask.subtasks.map(s =>
        s.id === subtaskId ? { ...s, reminder_date: reminderDate, modified_by: user?.id, modified_by_name: userName, updated_at: new Date().toISOString() } : s
      )
    })

    if (!demoMode) {
      await db.updateSubtask(subtaskId, { reminder_date: reminderDate, modified_by: user?.id })

      // Notify collaborators about the subtask reminder only if scope === 'all'
      if (isShared && reminderDate && subtask && scope === 'all') {
        await db.notifyCollaborators(project.id, user?.id, {
          type: 'subtask_reminder_set',
          title: 'Reminder set on subtask',
          message: `${subtask.title} - ${formatReminderDate(reminderDate)}`,
          task_id: task.id,
          subtask_id: subtaskId
        })
      }
    }
  }

  const deleteSubtask = async (subtaskId) => {
    updateTask({ subtasks: currentTask.subtasks.filter(s => s.id !== subtaskId) })
    if (!demoMode) await db.deleteSubtask(subtaskId)
  }

  const addComment = async () => {
    if (!newComment.trim()) return
    const comment = {
      id: uuid(),
      content: newComment.trim(),
      user_id: user?.id,
      user_name: user?.user_metadata?.name || user?.email || 'Demo User',
      created_at: new Date().toISOString()
    }
    updateTask({ comments: [...(currentTask.comments || []), comment] })
    setNewComment('')

    if (!demoMode) {
      await db.createComment({ task_id: task.id, content: comment.content, user_id: user.id })
    }
  }

  const deleteTask = async () => {
    if (!window.confirm('Delete this task?')) return

    // Guard: mark as deleted so realtime handler won't resurrect it
    deletedTaskIdsRef.current.add(task.id)

    const now = new Date().toISOString()
    const updated = {
      ...project,
      updated_at: now,
      modified_by: user?.id,
      modified_by_name: userName,
      stages: project.stages.map((s, i) =>
        i === stageIndex ? { ...s, tasks: s.tasks.filter(t => t.id !== task.id) } : s
      )
    }
    const newProjects = projects.map(p => p.id === project.id ? updated : p)
    setProjects(newProjects)
    if (demoMode) saveLocal(newProjects)
    if (!demoMode) await db.deleteTask(task.id)
    setSelectedTask(null)
    setView('project')

    // Cleanup guard after propagation delay
    setTimeout(() => deletedTaskIdsRef.current.delete(task.id), 8000)
  }

  // Sort subtasks: overdue first
  const sortedSubtasks = [...(currentTask.subtasks || [])].sort((a, b) => {
    if (a.is_completed !== b.is_completed) return a.is_completed ? 1 : -1
    if ((a.order_index || 0) !== (b.order_index || 0)) return (a.order_index || 0) - (b.order_index || 0)
    return new Date(a.created_at || 0) - new Date(b.created_at || 0)
  })

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 pb-16">
      <div className="bg-white/80 backdrop-blur-lg border-b border-gray-200 sticky top-16 z-30">
        <div className="max-w-3xl mx-auto px-3 sm:px-4 py-3 sm:py-4">
          <button
            onClick={() => { setSelectedTask(null); setView('project'); }}
            className="flex items-center gap-2 text-gray-500 hover:text-gray-700"
          >
            <ChevronLeft className="w-4 h-4" />
            <span className="text-sm font-medium truncate">Back to {project.title}</span>
          </button>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-3 sm:px-4 py-6 sm:py-8 space-y-6 sm:space-y-8">
        {/* Task Header */}
        <div className={`flex items-start gap-3 sm:gap-4 p-4 rounded-xl ${taskOverdue ? 'bg-red-50 border border-red-200' : ''}`}>
          <button
            onClick={toggleTaskCompletion}
            className={`checkbox-custom mt-1 flex-shrink-0 ${currentTask.is_completed ? 'checked' : ''}`}
            style={{ width: 28, height: 28 }}
          >
            {currentTask.is_completed && <Check className="w-4 h-4" />}
          </button>
          <div className="flex-1 min-w-0">
            {isEditingTitle ? (
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <input
                  type="text"
                  value={localTitle}
                  onChange={e => setLocalTitle(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      saveTitle()
                    } else if (e.key === 'Escape') {
                      cancelTitleEdit()
                    }
                  }}
                  className={`w-full min-w-0 flex-1 text-xl sm:text-2xl font-bold bg-white border border-gray-200 rounded-lg px-2 py-1 outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 ${taskOverdue ? 'text-red-700' : ''}`}
                  autoFocus
                />
                <button
                  onClick={saveTitle}
                  className="w-full sm:w-auto px-3 py-1.5 text-sm font-medium text-white bg-gray-800 hover:bg-gray-900 rounded-lg shadow-sm transition-all"
                >
                  Save
                </button>
                <button
                  onClick={cancelTitleEdit}
                  className="w-full sm:w-auto px-3 py-1.5 text-sm font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <div className="flex items-start gap-2 group/title">
                <h2 className={`min-w-0 break-words text-xl sm:text-2xl font-bold ${taskOverdue ? 'text-red-700' : 'text-gray-900'}`}>{currentTask.title}</h2>
                <button
                  onClick={() => setIsEditingTitle(true)}
                  className="shrink-0 p-1 text-gray-400 hover:text-blue-500 hover:bg-blue-50 rounded-lg transition-opacity opacity-0 group-hover/title:opacity-100"
                  title="Rename Task"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                </button>
              </div>
            )}
            {/* Tags Display and Picker Button */}
            <div className="flex flex-wrap items-center gap-2 mt-2">
              {/* Existing Tags Pills */}
              {(currentTask.tags || []).map(tag => {
                // Find tag definition to get color (or use tag.color directly if embedded)
                const tagDef = tags.find(t => t.id === tag.id) || tag
                // Map color name to classes (simplified map, should ideally share with TagPicker)
                const colorMap = {
                  blue: { bg: 'bg-blue-100', text: 'text-blue-700' },
                  green: { bg: 'bg-green-100', text: 'text-green-700' },
                  red: { bg: 'bg-red-100', text: 'text-red-700' },
                  amber: { bg: 'bg-amber-100', text: 'text-amber-700' },
                  purple: { bg: 'bg-purple-100', text: 'text-purple-700' },
                  pink: { bg: 'bg-pink-100', text: 'text-pink-700' },
                  indigo: { bg: 'bg-indigo-100', text: 'text-indigo-700' },
                  gray: { bg: 'bg-gray-100', text: 'text-gray-700' }
                }
                const colors = colorMap[tagDef.color] || colorMap.blue

                return (
                  <span key={tag.id} className={`px-2 py-0.5 rounded-md text-xs font-medium ${colors.bg} ${colors.text} flex items-center gap-1`}>
                    {tag.name}
                    <button
                      onClick={(e) => { e.stopPropagation(); unassignTag(task.id, tag.id); }}
                      className="hover:text-red-600"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                )
              })}

              <div className="relative">
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    if (activeTagPicker?.taskId === task.id && !activeTagPicker?.subtaskId) {
                      setActiveTagPicker(null)
                    } else {
                      const rect = e.currentTarget.getBoundingClientRect()
                      setActiveTagPicker({
                        taskId: task.id,
                        position: { top: rect.bottom + 8, left: rect.left }
                      })
                    }
                  }}
                  className={`p-1.5 hover:bg-gray-100 rounded-lg text-gray-400 hover:text-gray-600 transition-colors flex items-center gap-1 text-xs ${activeTagPicker?.taskId === task.id && !activeTagPicker?.subtaskId ? 'bg-gray-100 text-gray-900' : ''}`}
                  title="Manage Tags"
                >
                  <Tag className="w-3.5 h-3.5" />
                  {(currentTask.tags?.length || 0) === 0 && <span className="hidden sm:inline">Add Tag</span>}
                </button>
                {activeTagPicker?.taskId === task.id && !activeTagPicker?.subtaskId && (
                  <TagPicker
                    tags={tags}
                    assignedTagIds={new Set((currentTask.tags || []).map(t => t.id))}
                    onAssign={(tagId) => assignTag(task.id, tagId)}
                    onUnassign={(tagId) => unassignTag(task.id, tagId)}
                    onCreate={createTag}
                    onEdit={editTag}
                    onDelete={deleteTag}
                    onClose={() => setActiveTagPicker(null)}
                    position={activeTagPicker.position}
                  />
                )}
              </div>
            </div>

            {/* Timestamps and Reminder */}
            <div className="flex items-center gap-3 sm:gap-4 mt-2 text-xs text-gray-400 flex-wrap">
              <ReminderPicker
                value={currentTask.reminder_date}
                onChange={updateTaskReminder}
              />
              <button
                onClick={(e) => { e.stopPropagation(); addToToday(currentTask, { projectId: project.id }) }}
                className="p-2 text-gray-400 hover:text-green-600 hover:bg-green-50 rounded-lg transition-colors"
                title="Add task to Tod(o)ay"
              >
                <Sun className="w-4 h-4" />
              </button>
              {currentTask.created_at && (
                <span className="flex items-center gap-1 hidden sm:flex" title={`${new Date(currentTask.created_at).toLocaleString()}${currentTask.created_by_name ? ` by ${currentTask.created_by_name}` : ''}`}>
                  <Clock className="w-3 h-3" />
                  Created {formatRelativeDate(currentTask.created_at)}{isShared && currentTask.created_by_name && ` by ${currentTask.created_by === user?.id ? 'you' : currentTask.created_by_name}`}
                </span>
              )}
              {currentTask.updated_at && currentTask.updated_at !== currentTask.created_at && (
                <span className="hidden sm:inline" title={`${new Date(currentTask.updated_at).toLocaleString()}${currentTask.modified_by_name ? ` by ${currentTask.modified_by_name}` : ''}`}>
                  • Modified {formatRelativeDate(currentTask.updated_at)}{isShared && currentTask.modified_by_name && ` by ${currentTask.modified_by === user?.id ? 'you' : currentTask.modified_by_name}`}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Description */}
        <div className="glass-card rounded-xl p-4 sm:p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Description</h3>
            {!isEditingDescription && (
              <button
                onClick={() => setIsEditingDescription(true)}
                className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                title="Edit Description"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
              </button>
            )}
          </div>

          {isEditingDescription ? (
            <div className="space-y-3">
              <textarea
                value={localDescription}
                onChange={e => setLocalDescription(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && e.shiftKey) {
                    e.preventDefault();
                    saveDescription();
                  }
                }}
                placeholder="Add a description..."
                className="w-full min-h-[100px] bg-white border border-gray-200 rounded-lg p-3 resize-y outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 transition-all text-gray-700"
                autoFocus
              />
              <div className="flex gap-2 justify-end">
                <button
                  onClick={cancelDescriptionEdit}
                  className="px-3 py-1.5 text-sm font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={saveDescription}
                  className="px-3 py-1.5 text-sm font-medium text-white bg-gray-800 hover:bg-gray-900 rounded-lg shadow-sm transition-all"
                >
                  Save
                </button>
              </div>
            </div>
          ) : (
            <div className="group">
              <div
                className={`text-gray-700 whitespace-pre-wrap ${!currentTask.description ? 'text-gray-400 italic' : ''}`}
                onDoubleClick={() => setIsEditingDescription(true)}
              >
                {currentTask.description || 'No description provided.'}
              </div>
              {currentTask.updated_at && (
                <div className="mt-3 text-xs text-gray-400 border-t border-gray-100 pt-2 flex items-center gap-1">
                  <span>Modified {formatRelativeDate(currentTask.updated_at)}</span>
                  {isShared && currentTask.modified_by_name && <span>by {currentTask.modified_by === user?.id ? 'you' : currentTask.modified_by_name}</span>}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Subtasks */}
        <div className="glass-card rounded-xl p-4 sm:p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Subtasks</h3>
            {(currentTask.subtasks?.length || 0) > 0 && (
              <div className="flex items-center gap-2">
                {isSubtaskSelectionMode ? (
                  <>
                    <button
                      onClick={selectAllSubtasks}
                      className="text-xs px-2 py-1 rounded bg-gray-100 hover:bg-gray-200"
                    >
                      {selectedSubtaskIds.size === (currentTask.subtasks?.length || 0) ? 'Deselect All' : 'Select All'}
                    </button>
                    <button
                      onClick={handleBulkDeleteSubtasks}
                      disabled={selectedSubtaskIds.size === 0}
                      className="text-xs px-2 py-1 rounded bg-red-100 text-red-600 hover:bg-red-200 disabled:opacity-50 flex items-center gap-1"
                    >
                      <Trash2 className="w-3 h-3" />
                      Delete ({selectedSubtaskIds.size})
                    </button>
                    <button
                      onClick={() => { setIsSubtaskSelectionMode(false); setSelectedSubtaskIds(new Set()) }}
                      className="text-xs px-2 py-1 rounded bg-gray-100 hover:bg-gray-200"
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => setIsSubtaskSelectionMode(true)}
                    className="text-xs px-2 py-1 rounded bg-gray-100 hover:bg-gray-200 flex items-center gap-1"
                  >
                    <Check className="w-3 h-3" />
                    Select
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Add subtask bar on top */}
          <div className="flex gap-2 mb-4">
            <input
              type="text"
              placeholder="Add subtask..."
              value={newSubtask}
              onChange={e => setNewSubtask(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  addSubtask()
                }
              }}
              className="input-sleek"
            />
            <button onClick={addSubtask} className="p-3 hover:bg-gray-100 rounded-lg">
              <Plus className="w-5 h-5 text-gray-500" />
            </button>
          </div>

          <div className="space-y-2 mb-4">
              {sortedSubtasks.map((s, idx) => {
                const subtaskOverdue = isOverdue(s.reminder_date) && !s.is_completed
                const isSelected = selectedSubtaskIds.has(s.id)
                return (
                  <div
                    key={s.id}
                    draggable="true"
                    onDragStart={(e) => onSubtaskDragStart(e, idx)}
                    onDragOver={onSubtaskDragOver}
                    onDrop={(e) => onSubtaskDrop(e, idx)}
                    className={`p-3 rounded-lg transition-colors relative group ${subtaskOverdue ? 'bg-red-50 border-l-2 border-l-red-400' : 'bg-gray-50'
                      } ${isSelected ? 'ring-2 ring-brand-500 bg-brand-50' : ''}`}
                  >
                    <div className="absolute left-0 top-3 opacity-0 group-hover:opacity-40 p-1 text-gray-400 cursor-grab active:cursor-grabbing">
                      <GripVertical className="w-3.5 h-3.5" />
                    </div>

                    {/* Row 1: Checkbox + Title */}
                    <div className="flex items-start gap-2 sm:gap-3">
                      {isSubtaskSelectionMode ? (
                        <button
                          onClick={(e) => toggleSubtaskSelection(s.id, e)}
                          className={`w-5 h-5 rounded border-2 flex-shrink-0 flex items-center justify-center transition-colors mt-0.5 ${isSelected
                            ? 'bg-brand-600 border-brand-600 text-white'
                            : 'border-gray-300 hover:border-gray-400'
                            }`}
                        >
                          {isSelected && <Check className="w-3 h-3" />}
                        </button>
                      ) : (
                        <button
                          onClick={() => toggleSubtask(s.id)}
                          className={`checkbox-custom flex-shrink-0 mt-0.5 ${s.is_completed ? 'checked' : ''}`}
                          style={{ width: 20, height: 20 }}
                        >
                          {s.is_completed && <Check className="w-3 h-3" />}
                        </button>
                      )}
                      <div className="min-w-0 flex-1">
                        {editingSubtaskId === s.id ? (
                          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                            <input
                              type="text"
                              value={editingSubtaskTitle}
                              onChange={e => setEditingSubtaskTitle(e.target.value)}
                              onKeyDown={e => {
                                if (e.key === 'Enter' && (!e.shiftKey || e.shiftKey)) updateSubtaskTitle(s.id, editingSubtaskTitle)
                                if (e.key === 'Escape') setEditingSubtaskId(null)
                              }}
                              className="flex-1 bg-white rounded px-2 py-1 border border-gray-300 text-sm focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 outline-none"
                              autoFocus
                              onClick={e => e.stopPropagation()}
                            />
                            <div className="flex items-center gap-2 flex-shrink-0">
                              <button onClick={() => updateSubtaskTitle(s.id, editingSubtaskTitle)} className="text-xs font-medium text-blue-600 hover:text-blue-700 px-2 py-1 rounded hover:bg-blue-50">Save</button>
                              <button onClick={() => setEditingSubtaskId(null)} className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1 rounded hover:bg-gray-100">Cancel</button>
                            </div>
                          </div>
                        ) : (
                          <div>
                            <span className={`text-sm break-words ${s.is_completed ? 'line-through text-gray-400' : subtaskOverdue ? 'text-red-700' : 'text-gray-700'}`} title={s.title}>
                              {s.title}
                            </span>
                            {/* Subtask Tag Pills */}
                            {s.tags?.length > 0 && (
                              <div className="flex flex-wrap gap-1 mt-1">
                                {s.tags.map(tag => {
                                  const colorMap = {
                                    blue: 'bg-blue-100 text-blue-700',
                                    green: 'bg-green-100 text-green-700',
                                    red: 'bg-red-100 text-red-700',
                                    amber: 'bg-amber-100 text-amber-700',
                                    purple: 'bg-purple-100 text-purple-700',
                                    pink: 'bg-pink-100 text-pink-700',
                                    indigo: 'bg-indigo-100 text-indigo-700',
                                    gray: 'bg-gray-100 text-gray-700'
                                  }
                                  const colorClasses = colorMap[tag.color] || colorMap.blue
                                  return (
                                    <span key={tag.id} className={`px-1.5 py-0.5 rounded text-[9px] font-medium ${colorClasses}`}>
                                      {tag.name}
                                    </span>
                                  )
                                })}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Row 2: Action buttons — always accessible, separate from title */}
                    {!isSubtaskSelectionMode && editingSubtaskId !== s.id && (
                      <div className="flex items-center gap-1.5 mt-2 ml-7 sm:ml-8">
                        {/* Add to Today Sun Icon */}
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            const proj = projects?.find(p => p.id === task.project_id)
                            addSubtaskToToday(s, task, { projectId: proj?.id })
                          }}
                          className="p-1 text-gray-400 hover:text-amber-500 rounded hover:bg-amber-50"
                          title="Add to Tod(o)ay"
                        >
                          <Sun className="w-3.5 h-3.5" />
                        </button>

                        {/* Tag Button */}
                        <div className="relative">
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              if (activeTagPicker?.subtaskId === s.id) {
                                setActiveTagPicker(null)
                              } else {
                                const rect = e.currentTarget.getBoundingClientRect()
                                setActiveTagPicker({
                                  taskId: task.id,
                                  subtaskId: s.id,
                                  position: { top: rect.bottom + 8, right: window.innerWidth - rect.right }
                                })
                              }
                            }}
                            className={`p-1 text-gray-400 hover:text-gray-600 rounded hover:bg-gray-100 ${activeTagPicker?.subtaskId === s.id ? 'bg-gray-100 text-gray-900' : ''}`}
                            title="Tags"
                          >
                            <Tag className="w-3.5 h-3.5" />
                          </button>
                          {activeTagPicker?.subtaskId === s.id && (
                            <TagPicker
                              tags={tags}
                              assignedTagIds={new Set((s.tags || []).map(t => t.id))}
                              onAssign={(tagId) => assignTag(task.id, tagId, s.id)}
                              onUnassign={(tagId) => unassignTag(task.id, tagId, s.id)}
                              onCreate={createTag}
                              onEdit={editTag}
                              onDelete={deleteTag}
                              onClose={() => setActiveTagPicker(null)}
                              position={activeTagPicker.position}
                            />
                          )}
                        </div>

                        {/* Reminder */}
                        <ReminderPicker
                          value={s.reminder_date}
                          onChange={(date, scope) => updateSubtaskReminder(s.id, date, scope)}
                          compact
                          isShared={isShared}
                        />

                        {/* Edit/Delete */}
                        {!s.is_completed && (
                          <div className="flex items-center gap-1 border-l border-gray-200 ml-1 pl-1">
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                setEditingSubtaskId(s.id)
                                setEditingSubtaskTitle(s.title)
                              }}
                              className="p-1 text-gray-400 hover:text-blue-500 rounded hover:bg-blue-50"
                              title="Edit subtask"
                            >
                              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                deleteSubtask(s.id)
                              }}
                              className="p-1 text-gray-400 hover:text-red-500 rounded hover:bg-red-50"
                              title="Delete subtask"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Timestamp & Attribution Row */}
                    <div className="text-xs text-gray-400 mt-1 ml-7 sm:ml-8 flex flex-wrap items-center gap-2">
                      {s.created_at && (
                        <span title={new Date(s.created_at).toLocaleString()}>
                          {formatRelativeDate(s.created_at)}
                          {isShared && s.created_by_name && ` by ${s.created_by === user?.id ? 'you' : s.created_by_name}`}
                        </span>
                      )}
                      {s.updated_at && (new Date(s.updated_at).getTime() > new Date(s.created_at).getTime() + 1000) && (
                        <span className="italic text-gray-300">
                          • Edited {formatRelativeDate(s.updated_at)}
                          {isShared && s.modified_by_name && ` by ${s.modified_by === user?.id ? 'you' : s.modified_by_name}`}
                        </span>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>

        </div>

        {/* Comments */}
        <div className="glass-card rounded-xl p-5">
          <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-4">Comments</h3>
          <div className="space-y-4 mb-4">
            {currentTask.comments?.map(c => {
              const isOwner = c.user_id === user?.id
              const isEditing = editingCommentId === c.id
              const wasEdited = c.updated_at && c.created_at && c.updated_at !== c.created_at

              return (
                <div key={c.id} className="flex gap-3 group">
                  <div className="avatar text-xs flex-shrink-0">{c.user_name?.[0] || '?'}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <div className="text-sm font-semibold text-gray-900">{c.user_name}</div>
                      {isOwner && !isEditing && (
                        <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={() => startEditingComment(c)}
                            className="p-1 text-gray-400 hover:text-blue-500"
                            title="Edit"
                          >
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                          </button>
                          <button
                            onClick={() => deleteComment(c.id)}
                            className="p-1 text-gray-400 hover:text-red-500"
                            title="Delete"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      )}
                    </div>

                    {isEditing ? (
                      <div className="mt-1">
                        <textarea
                          value={editingCommentContent}
                          onChange={e => {
                            setEditingCommentContent(e.target.value)
                            e.target.style.height = 'auto'
                            e.target.style.height = e.target.scrollHeight + 'px'
                          }}
                          onKeyDown={e => {
                            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                              e.preventDefault();
                              saveCommentEdit(c.id);
                            }
                            if (e.key === 'Escape') setEditingCommentId(null)
                          }}
                          className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-brand-500 focus:border-transparent outline-none resize-none min-h-[60px]"
                          autoFocus
                          onFocus={e => {
                            e.target.style.height = 'auto'
                            e.target.style.height = e.target.scrollHeight + 'px'
                          }}
                        />
                        <div className="flex gap-2 mt-2 text-xs">
                          <button onClick={() => saveCommentEdit(c.id)} className="px-3 py-1.5 bg-gray-900 text-white rounded-md hover:bg-black font-medium transition-colors">Save</button>
                          <button onClick={() => setEditingCommentId(null)} className="px-3 py-1.5 text-gray-500 hover:bg-gray-100 rounded-md transition-colors">Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="text-sm text-gray-600 mt-1 whitespace-pre-wrap">{c.content}</div>
                        <div className="text-xs text-gray-400 mt-1 flex gap-2">
                          <span>{new Date(c.created_at).toLocaleString()}</span>
                          {wasEdited && <span className="italic text-gray-300">• Edited {formatRelativeDate(c.updated_at)}</span>}
                        </div>
                      </>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
          <div className="flex flex-col gap-2">
            <textarea
              placeholder="Write a comment..."
              value={newComment}
              onChange={e => {
                setNewComment(e.target.value)
                e.target.style.height = 'auto'
                e.target.style.height = Math.min(e.target.scrollHeight, 200) + 'px'
              }}
              onKeyDown={e => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  addComment();
                }
              }}
              className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 outline-none resize-none min-h-[45px] transition-all"
            />
            <div className="flex justify-between items-center px-1">
              <span className="text-[10px] text-gray-400">Press {navigator.platform.includes('Mac') ? '⌘' : 'Ctrl'} + Enter to post</span>
              <button onClick={addComment} className="btn-gradient px-4 py-1.5 text-sm rounded-lg opacity-90 hover:opacity-100 transition-opacity">Post</button>
            </div>
          </div>
        </div >

    {/* Delete */ }
    < button
  onClick = { deleteTask }
  className = "w-full py-3 bg-red-50 text-red-600 font-semibold rounded-xl hover:bg-red-100 transition-colors"
    >
    Delete Task
        </button >
      </div >
    </div >
  )
}

// ============================================
// ALL TASKS VIEW
// ============================================
function AllTasksView() {
  const { projects, setProjects, setSelectedProject, setSelectedTask, setView, tags, assignTag, unassignTag, createTag, editTag, deleteTag, deletedTaskIdsRef } = useApp()
  const { demoMode, user } = useAuth()
  const [activeSubTab, setActiveSubTab] = useState('active') // 'active', 'scheduled', 'complete', 'all'
  const [sortOption, setSortOption] = useState('priority')
  const [sortDirection, setSortDirection] = useState('asc')
  const [isSelectionMode, setIsSelectionMode] = useState(false)
  const [selectedTaskIds, setSelectedTaskIds] = useState(new Set())
  const [taskSearch, setTaskSearch] = useState('')

  const [expandedTasks, setExpandedTasks] = useState(new Set())
  const [activeTagPicker, setActiveTagPicker] = useState(null) // { taskId, subtaskId } | null
  const [selectedFilterTags, setSelectedFilterTags] = useState(new Set())
  const [tagFilterOpen, setTagFilterOpen] = useState(false)

  const handleSortChange = (newOption) => {
    if (newOption === sortOption) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc')
      return
    }

    setSortOption(newOption)
    if (newOption === 'created' || newOption === 'modified') {
      setSortDirection('desc')
    } else {
      setSortDirection('asc')
    }
  }

  // Collect all tasks, ensuring tasks within each stage are sorted by order_index
  const allTasks = []
  projects.forEach(p => {
    p.stages?.forEach((s, si) => {
      // Sort tasks within each stage by order_index before collecting
      const sortedStageTasks = [...(s.tasks || [])].sort((a, b) => (a.order_index || 0) - (b.order_index || 0))
      sortedStageTasks.forEach(t => {
        allTasks.push({ project: p, stage: s, stageIndex: si, stageOrder: s.order_index ?? si, task: t })
      })
    })
  })

  // Helper to check if a task has any scheduled subtasks
  const hasScheduledSubtasks = (task) => {
    return task.subtasks?.some(s => s.reminder_date && !s.is_completed) || false
  }

  // Helper to check if a task has tags (or its subtasks if we want to include them in the count)
  const hasTags = (task) => {
    return (task.tags && task.tags.length > 0) || (task.subtasks?.some(s => s.tags && s.tags.length > 0))
  }

  // Filter based on active sub-tab
  const filteredTasks = activeSubTab === 'scheduled'
    ? allTasks.filter(({ task }) => (task.reminder_date || hasScheduledSubtasks(task)) && !task.is_completed)
    : activeSubTab === 'active'
      ? allTasks.filter(({ task }) => !task.is_completed)
      : activeSubTab === 'complete'
        ? allTasks.filter(({ task }) => task.is_completed)
        : activeSubTab === 'tagged'
          ? allTasks.filter(({ task }) => hasTags(task))
          : allTasks

  // Apply Tag Filters
  const tagFilteredTasks = (activeSubTab === 'tagged' && selectedFilterTags.size > 0)
    ? filteredTasks.filter(({ task }) => {
      const taskTagIds = new Set((task.tags || []).map(t => t.id))
      const subtaskTagIds = new Set((task.subtasks || []).flatMap(s => (s.tags || []).map(t => t.id)))
      // Use OR logic matching any selected filter
      for (const tagId of selectedFilterTags) {
        if (taskTagIds.has(tagId) || subtaskTagIds.has(tagId)) return true
      }
      return false
    })
    : filteredTasks

  const searchQuery = taskSearch.trim().toLowerCase()
  const matchesSearch = ({ project, stage, task }) => {
    if (!searchQuery) return true
    const inTitle = task.title?.toLowerCase().includes(searchQuery)
    const inProject = project.title?.toLowerCase().includes(searchQuery)
    const inStage = stage.name?.toLowerCase().includes(searchQuery)
    const inTags = (task.tags || []).some(tag => tag.name?.toLowerCase().includes(searchQuery))
    const inSubtasks = (task.subtasks || []).some(st => st.title?.toLowerCase().includes(searchQuery))
    return inTitle || inProject || inStage || inTags || inSubtasks
  }

  const searchedTasks = searchQuery ? tagFilteredTasks.filter(matchesSearch) : tagFilteredTasks
  const displayedTasks = [...searchedTasks]

  // Sort tasks: overdue first, then by selected option
  const dir = sortDirection === 'asc' ? 1 : -1
  displayedTasks.sort((a, b) => {
    const aOverdue = isOverdue(a.task.reminder_date) && !a.task.is_completed
    const bOverdue = isOverdue(b.task.reminder_date) && !b.task.is_completed

    if (aOverdue && !bOverdue) return -1
    if (!aOverdue && bOverdue) return 1

    if (sortOption === 'priority') {
      if (a.project.priority_rank !== b.project.priority_rank) {
        return (a.project.priority_rank - b.project.priority_rank) * dir
      }
      const stageA = a.stageOrder ?? a.stageIndex
      const stageB = b.stageOrder ?? b.stageIndex
      if (stageA !== stageB) {
        return (stageA - stageB) * dir
      }
      const orderDiff = (a.task.order_index || 0) - (b.task.order_index || 0)
      if (orderDiff !== 0) return orderDiff * dir
      // Stable fallback: newer tasks lower priority when order_index ties
      return (new Date(a.task.created_at || 0) - new Date(b.task.created_at || 0)) * dir
    } else if (sortOption === 'created') {
      const dateA = new Date(a.task.created_at || 0).getTime()
      const dateB = new Date(b.task.created_at || 0).getTime()
      return (dateA - dateB) * dir
    } else if (sortOption === 'modified') {
      const dateA = new Date(a.task.updated_at || a.task.created_at || 0).getTime()
      const dateB = new Date(b.task.updated_at || b.task.created_at || 0).getTime()
      return (dateA - dateB) * dir
    }
    return 0
  })

  const toggleTaskSelection = (taskId, e) => {
    e.stopPropagation()
    const newSelected = new Set(selectedTaskIds)
    if (newSelected.has(taskId)) {
      newSelected.delete(taskId)
    } else {
      newSelected.add(taskId)
    }
    setSelectedTaskIds(newSelected)
  }

  const selectAllTasks = () => {
    if (selectedTaskIds.size === filteredTasks.length) {
      setSelectedTaskIds(new Set())
    } else {
      setSelectedTaskIds(new Set(filteredTasks.map(({ task }) => task.id)))
    }
  }

  const handleBulkComplete = async () => {
    if (selectedTaskIds.size === 0) return

    const now = new Date().toISOString()
    const newProjects = projects.map(project => ({
      ...project,
      updated_at: now,
      stages: project.stages?.map(stage => ({
        ...stage,
        tasks: stage.tasks?.map(task => {
          if (selectedTaskIds.has(task.id)) {
            // Mark task complete and all its subtasks
            return {
              ...task,
              is_completed: true,
              updated_at: now,
              subtasks: task.subtasks?.map(s => ({ ...s, is_completed: true })) || []
            }
          }
          return task
        }) || []
      })) || []
    }))

    setProjects(newProjects)
    if (demoMode) saveLocal(newProjects)

    if (!demoMode) {
      for (const { task } of filteredTasks) {
        if (selectedTaskIds.has(task.id)) {
          await db.updateTask(task.id, { is_completed: true })
          // Also complete all subtasks
          if (task.subtasks?.length > 0) {
            for (const subtask of task.subtasks) {
              if (!subtask.is_completed) {
                await db.updateSubtask(subtask.id, { is_completed: true })
              }
            }
          }
        }
      }
    }

    setSelectedTaskIds(new Set())
    setIsSelectionMode(false)
  }

  const handleBulkReopen = async () => {
    if (selectedTaskIds.size === 0) return

    const now = new Date().toISOString()
    const newProjects = projects.map(project => ({
      ...project,
      updated_at: now,
      stages: project.stages?.map(stage => ({
        ...stage,
        tasks: stage.tasks?.map(task => {
          if (selectedTaskIds.has(task.id)) {
            return {
              ...task,
              is_completed: false,
              updated_at: now
            }
          }
          return task
        }) || []
      })) || []
    }))

    setProjects(newProjects)
    if (demoMode) saveLocal(newProjects)

    if (!demoMode) {
      for (const { task } of filteredTasks) {
        if (selectedTaskIds.has(task.id)) {
          await db.updateTask(task.id, { is_completed: false })
        }
      }
    }

    setSelectedTaskIds(new Set())
    setIsSelectionMode(false)
  }

  const handleBulkDelete = async () => {
    if (selectedTaskIds.size === 0) return
    if (!window.confirm(`Delete ${selectedTaskIds.size} task(s)?`)) return

    // Guard: mark all as deleted so realtime handler won't resurrect them
    for (const taskId of selectedTaskIds) {
      deletedTaskIdsRef.current.add(taskId)
    }

    // Delete each selected task
    const newProjects = projects.map(project => ({
      ...project,
      stages: project.stages?.map(stage => ({
        ...stage,
        tasks: stage.tasks?.filter(task => !selectedTaskIds.has(task.id)) || []
      })) || []
    }))

    setProjects(newProjects)
    if (demoMode) saveLocal(newProjects)

    if (!demoMode) {
      for (const taskId of selectedTaskIds) {
        await db.deleteTask(taskId)
      }
    }

    // Cleanup guards after propagation delay
    setTimeout(() => {
      for (const taskId of selectedTaskIds) {
        deletedTaskIdsRef.current.delete(taskId)
      }
    }, 8000)

    setSelectedTaskIds(new Set())
    setIsSelectionMode(false)
  }

  const toggleExpanded = (taskId) => {
    setExpandedTasks(prev => {
      const newSet = new Set(prev)
      if (newSet.has(taskId)) {
        newSet.delete(taskId)
      } else {
        newSet.add(taskId)
      }
      return newSet
    })
  }

  const toggleSubtask = async (projectId, stageIndex, taskId, subtaskId) => {
    const project = projects.find(p => p.id === projectId)
    if (!project) return
    const task = project.stages[stageIndex]?.tasks?.find(t => t.id === taskId)
    if (!task) return
    const subtask = task.subtasks?.find(s => s.id === subtaskId)
    if (!subtask) return

    const now = new Date().toISOString()
    const updatedProject = {
      ...project,
      updated_at: now,
      stages: project.stages.map((s, i) =>
        i === stageIndex
          ? {
            ...s, tasks: s.tasks.map(t =>
              t.id === taskId
                ? { ...t, subtasks: t.subtasks.map(st => st.id === subtaskId ? { ...st, is_completed: !st.is_completed } : st), updated_at: now }
                : t
            )
          }
          : s
      )
    }
    const newProjects = projects.map(p => p.id === projectId ? updatedProject : p)
    setProjects(newProjects)
    if (demoMode) saveLocal(newProjects)

    if (!demoMode) {
      await db.updateSubtask(subtaskId, { is_completed: !subtask.is_completed })
    }
  }

  const updateSubtaskReminder = async (projectId, stageIndex, taskId, subtaskId, reminderDate, scope = 'all') => {
    const project = projects.find(p => p.id === projectId)
    if (!project) return

    const now = new Date().toISOString()
    const updatedProject = {
      ...project,
      stages: project.stages.map((s, i) =>
        i === stageIndex
          ? {
            ...s, tasks: s.tasks.map(t =>
              t.id === taskId
                ? { ...t, subtasks: t.subtasks.map(st => st.id === subtaskId ? { ...st, reminder_date: reminderDate } : st), updated_at: now }
                : t
            )
          }
          : s
      )
    }
    const newProjects = projects.map(p => p.id === projectId ? updatedProject : p)
    setProjects(newProjects)
    if (demoMode) saveLocal(newProjects)

    if (!demoMode) {
      await db.updateSubtask(subtaskId, { reminder_date: reminderDate, modified_by: user?.id })
      // Notify collaborators only if scope === 'all' and project is shared
      const isCollaborator = project.owner_id !== user?.id
      const hasMembers = project.project_members?.length > 0
      const isShared = isCollaborator || hasMembers
      if (isShared && reminderDate && scope === 'all') {
        await db.notifyCollaborators(projectId, user?.id, {
          type: 'subtask_reminder_set',
          title: 'Reminder set on subtask',
          message: `Subtask reminder updated`,
          task_id: taskId,
          subtask_id: subtaskId
        })
      }
    }
  }


  const activeCount = allTasks.filter(({ task }) => !task.is_completed).length
  const scheduledCount = allTasks.filter(({ task }) => (task.reminder_date || hasScheduledSubtasks(task)) && !task.is_completed).length
  const completeCount = allTasks.filter(({ task }) => task.is_completed).length
  const taggedCount = allTasks.filter(({ task }) => hasTags(task)).length
  const allCount = allTasks.length

  return (
    <div className="max-w-5xl mx-auto px-3 sm:px-6 lg:px-8 py-4 sm:py-8">
      <div className="flex flex-col gap-3 sm:gap-4 mb-4 sm:mb-6">
        {/* Sub-tabs for Scheduled vs All with selection controls */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-0 border-b border-gray-200 pb-2 sm:pb-0">
          <div className="flex items-center gap-1 sm:gap-2 overflow-x-auto -mx-3 px-3 sm:mx-0 sm:px-0">
            <button
              onClick={() => { setActiveSubTab('active'); setSelectedTaskIds(new Set()) }}
              className={`px-3 sm:px-4 py-2 text-xs sm:text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${activeSubTab === 'active'
                ? 'border-brand-600 text-brand-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
            >
              <List className="w-3.5 h-3.5 sm:w-4 sm:h-4 inline mr-1" />
              Active ({activeCount})
            </button>
            <button
              onClick={() => { setActiveSubTab('scheduled'); setSelectedTaskIds(new Set()) }}
              className={`px-3 sm:px-4 py-2 text-xs sm:text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${activeSubTab === 'scheduled'
                ? 'border-brand-600 text-brand-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
            >
              <Clock className="w-3.5 h-3.5 sm:w-4 sm:h-4 inline mr-1" />
              Scheduled ({scheduledCount})
            </button>
            <button
              onClick={() => { setActiveSubTab('complete'); setSelectedTaskIds(new Set()) }}
              className={`px-3 sm:px-4 py-2 text-xs sm:text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${activeSubTab === 'complete'
                ? 'border-brand-600 text-brand-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
            >
              <CheckCircle className="w-3.5 h-3.5 sm:w-4 sm:h-4 inline mr-1" />
              Complete ({completeCount})
            </button>

            <button
              onClick={() => { setActiveSubTab('tagged'); setSelectedTaskIds(new Set()) }}
              className={`px-3 sm:px-4 py-2 text-xs sm:text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${activeSubTab === 'tagged'
                ? 'border-brand-600 text-brand-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
            >
              <Tag className="w-3.5 h-3.5 sm:w-4 sm:h-4 inline mr-1" />
              Tagged ({taggedCount})
            </button>
            <button
              onClick={() => { setActiveSubTab('all'); setSelectedTaskIds(new Set()) }}
              className={`px-3 sm:px-4 py-2 text-xs sm:text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${activeSubTab === 'all'
                ? 'border-brand-600 text-brand-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
            >
              <LayoutGrid className="w-3.5 h-3.5 sm:w-4 sm:h-4 inline mr-1" />
              All ({allCount})
            </button>
          </div>
          <div className="flex items-center gap-1 sm:gap-2">
            {isSelectionMode ? (
              <>
                <button
                  onClick={selectAllTasks}
                  className="text-[10px] sm:text-sm px-2 sm:px-3 py-1 sm:py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200"
                >
                  {selectedTaskIds.size === filteredTasks.length ? 'Deselect' : 'Select All'}
                </button>
                {activeSubTab === 'complete' ? (
                  <button
                    onClick={handleBulkReopen}
                    disabled={selectedTaskIds.size === 0}
                    className="text-[10px] sm:text-sm px-2 sm:px-3 py-1 sm:py-1.5 rounded-lg bg-amber-100 text-amber-600 hover:bg-amber-200 disabled:opacity-50 flex items-center gap-1"
                  >
                    <ChevronUp className="w-3 h-3" />
                    <span className="hidden sm:inline">Reopen</span> ({selectedTaskIds.size})
                  </button>
                ) : (
                  <button
                    onClick={handleBulkComplete}
                    disabled={selectedTaskIds.size === 0}
                    className="text-[10px] sm:text-sm px-2 sm:px-3 py-1 sm:py-1.5 rounded-lg bg-green-100 text-green-600 hover:bg-green-200 disabled:opacity-50 flex items-center gap-1"
                  >
                    <CheckCircle className="w-3 h-3" />
                    <span className="hidden sm:inline">Complete</span> ({selectedTaskIds.size})
                  </button>
                )}
                <button
                  onClick={handleBulkDelete}
                  disabled={selectedTaskIds.size === 0}
                  className="text-[10px] sm:text-sm px-2 sm:px-3 py-1 sm:py-1.5 rounded-lg bg-red-100 text-red-600 hover:bg-red-200 disabled:opacity-50 flex items-center gap-1"
                >
                  <Trash2 className="w-3 h-3" />
                  <span className="hidden sm:inline">Delete</span> ({selectedTaskIds.size})
                </button>
                <button
                  onClick={() => { setIsSelectionMode(false); setSelectedTaskIds(new Set()) }}
                  className="text-[10px] sm:text-sm px-2 sm:px-3 py-1 sm:py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200"
                >
                  Cancel
                </button>
              </>
            ) : (
              <button
                onClick={() => setIsSelectionMode(true)}
                className="text-[10px] sm:text-sm px-2 sm:px-3 py-1 sm:py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 flex items-center gap-1"
              >
                <Check className="w-3 h-3" />
                Select
              </button>
            )}
          </div>
        </div>

        {/* Sort, Filter, and Search Bar */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-2 mb-2 relative z-40">
          <div className="relative w-full sm:w-64 flex-shrink-0">
            <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={taskSearch}
              onChange={(e) => setTaskSearch(e.target.value)}
              placeholder="Search tasks..."
              className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-gray-200 bg-white shadow-sm focus:ring-2 focus:ring-brand-200 focus:border-brand-400 transition"
            />
          </div>

          <div className="flex items-center gap-2 flex-1">
            {/* Sort options (scrollable) */}
            <div className="flex items-center gap-1 overflow-x-auto pb-1 -mx-3 px-3 sm:mx-0 sm:px-0 flex-1 no-scrollbar">
              {[{ key: 'priority', label: 'Priority' }, { key: 'created', label: 'Created' }, { key: 'modified', label: 'Modified' }].map(opt => (
                <button
                  key={opt.key}
                  onClick={() => handleSortChange(opt.key)}
                  className={`px-2 sm:px-3 py-1 sm:py-2 text-[10px] sm:text-sm rounded-lg transition-colors flex items-center gap-0.5 sm:gap-1 whitespace-nowrap ${sortOption === opt.key
                    ? 'bg-gray-200 text-gray-900 font-medium'
                    : 'text-gray-600 hover:bg-gray-100'
                    }`}
                >
                  {opt.label}
                  {sortOption === opt.key && (
                    sortDirection === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />
                  )}
                </button>
              ))}
            </div>

            {/* Tag Filter Dropdown (Fixed, not scrollable) */}
            {activeSubTab === 'tagged' && (
              <div className="relative flex-shrink-0">
                <button
                  onClick={() => setTagFilterOpen(!tagFilterOpen)}
                  className={`px-2 sm:px-3 py-1 sm:py-2 text-[10px] sm:text-sm rounded-lg transition-colors flex items-center gap-1 whitespace-nowrap ${selectedFilterTags.size > 0
                    ? 'bg-brand-100 text-brand-700 font-medium'
                    : 'text-gray-600 hover:bg-gray-100'
                    }`}
                >
                  <Tag className="w-3 h-3" />
                  Filter {selectedFilterTags.size > 0 ? `(${selectedFilterTags.size})` : ''}
                </button>
                {tagFilterOpen && (
                  <>
                    {/* Click outside backdrop - fixed to viewport */}
                    <div className="fixed inset-0 z-[45]" onClick={() => setTagFilterOpen(false)} />
                    <div className="absolute right-0 top-full mt-1 w-48 bg-white rounded-xl shadow-xl border border-gray-200 z-[50] p-2 animate-fade-in">
                      <div className="text-xs font-semibold text-gray-500 mb-2 px-1">Filter by Tag</div>
                      <div className="max-h-48 overflow-y-auto space-y-1">
                        {tags.length === 0 && <div className="text-xs text-gray-400 px-1">No tags available</div>}
                        {tags.map(tag => (
                          <label key={tag.id} className="flex items-center gap-2 px-2 py-1.5 hover:bg-gray-50 rounded cursor-pointer">
                            <input
                              type="checkbox"
                              checked={selectedFilterTags.has(tag.id)}
                              onChange={() => {
                                const newSet = new Set(selectedFilterTags)
                                if (newSet.has(tag.id)) newSet.delete(tag.id)
                                else newSet.add(tag.id)
                                setSelectedFilterTags(newSet)
                              }}
                              className="rounded border-gray-300 text-brand-600 focus:ring-brand-500 w-3.5 h-3.5"
                            />
                            <span className="text-sm truncate">{tag.name}</span>
                          </label>
                        ))}
                      </div>
                      {selectedFilterTags.size > 0 && (
                        <button
                          onClick={() => setSelectedFilterTags(new Set())}
                          className="w-full mt-2 py-1 text-xs text-red-600 hover:bg-red-50 rounded"
                        >
                          Clear Filters
                        </button>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {displayedTasks.length === 0 ? (
        <div className="glass-card rounded-2xl p-6 sm:p-12 text-center">
          <h2 className="text-base sm:text-xl font-bold text-gray-900 mb-2">
            {activeSubTab === 'scheduled' ? 'No scheduled tasks'
              : activeSubTab === 'complete' ? 'No completed tasks'
                : activeSubTab === 'active' ? 'No active tasks'
                  : activeSubTab === 'tagged' ? 'No tagged tasks found'
                    : 'No tasks yet'}
          </h2>
          <p className="text-gray-500 text-sm sm:text-base">
            {activeSubTab === 'scheduled'
              ? 'Tasks with reminders will appear here'
              : activeSubTab === 'complete'
                ? 'Completed tasks will appear here'
                : activeSubTab === 'active'
                  ? 'Active tasks will appear here'
                  : 'Create a project and add some tasks!'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {displayedTasks.map(({ project, stage, stageIndex, task }, i) => {
            const taskOverdue = isOverdue(task.reminder_date) && !task.is_completed
            const isSelected = selectedTaskIds.has(task.id)
            const isExpanded = expandedTasks.has(task.id)
            const hasSubtasks = task.subtasks?.length > 0
            const isCompleted = task.is_completed
            return (
              <div
                key={`${project.id}-${task.id}`}
                className={`glass-card glass-card-hover rounded-xl animate-fade-in ${taskOverdue ? 'bg-red-50/80 border-l-4 border-l-red-400' : ''
                  } ${isSelected ? 'ring-2 ring-brand-500 bg-brand-50' : ''} ${isCompleted ? 'opacity-60' : ''}`}
                style={{ animationDelay: `${i * 30}ms` }}
              >
                <div
                  className="p-3 sm:p-4 cursor-pointer"
                  onClick={() => {
                    if (isSelectionMode) {
                      toggleTaskSelection(task.id, { stopPropagation: () => { } })
                    } else {
                      setSelectedProject(project)
                      setSelectedTask({ task, stageIndex })
                      setView('task')
                    }
                  }}
                >
                  <div className="flex items-center gap-2 sm:gap-3">
                    {isSelectionMode && (
                      <button
                        onClick={(e) => toggleTaskSelection(task.id, e)}
                        className={`w-5 h-5 rounded border-2 flex-shrink-0 flex items-center justify-center transition-colors ${isSelected
                          ? 'bg-brand-600 border-brand-600 text-white'
                          : 'border-gray-300 hover:border-gray-400'
                          }`}
                      >
                        {isSelected && <Check className="w-3 h-3" />}
                      </button>
                    )}
                    <span className="text-xl sm:text-2xl flex-shrink-0">{project.emoji}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        {isCompleted && <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0" />}
                        <span className={`font-medium text-sm sm:text-base truncate ${isCompleted ? 'line-through text-gray-500' : taskOverdue ? 'text-red-700' : 'text-gray-900'}`}>{task.title}</span>
                      </div>
                      <div className="flex items-center gap-1.5 sm:gap-2 mt-0.5 sm:mt-1 flex-wrap">
                        <span className="flex items-center gap-1">
                          <PriorityBadge rank={project.priority_rank} />
                          <span className="text-xs sm:text-sm text-gray-600 truncate max-w-[120px] sm:max-w-none">{project.title}</span>
                        </span>
                        <span className="tag tag-default text-[8px] sm:text-[9px] px-1.5 py-0.5">{stage.name}</span>
                        {hasSubtasks && (
                          <button
                            onClick={(e) => { e.stopPropagation(); toggleExpanded(task.id); }}
                            className="flex items-center gap-0.5 text-[9px] sm:text-[10px] text-gray-500 hover:text-gray-700 transition-colors"
                          >
                            {isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                            <FileText className="w-3 h-3" />
                            {task.subtasks.filter(s => s.is_completed).length}/{task.subtasks.length}
                          </button>
                        )}
                        {task.reminder_date && (
                          <span className={`text-[9px] sm:text-[10px] flex items-center gap-0.5 ${taskOverdue ? 'text-red-600' : 'text-amber-600'}`}>
                            <Clock className="w-2.5 h-2.5 sm:w-3 sm:h-3" />
                            {formatReminderDate(task.reminder_date)}
                          </span>
                        )}
                        {/* Show scheduled subtask indicator if task has scheduled subtasks but no task reminder */}
                        {!task.reminder_date && hasScheduledSubtasks(task) && (
                          <span className="text-[9px] sm:text-[10px] flex items-center gap-0.5 text-purple-600 bg-purple-50 px-1.5 py-0.5 rounded">
                            <Clock className="w-2.5 h-2.5 sm:w-3 sm:h-3" />
                            Subtask scheduled
                          </span>
                        )}
                        {/* Show modified by for shared projects */}
                        {(project.owner_id !== user?.id || project.project_members?.length > 0) && (task.modified_by_name || task.created_by_name) && (
                          <span className="text-[9px] sm:text-[10px] text-gray-400 hidden sm:inline">
                            {task.modified_by_name && task.updated_at !== task.created_at
                              ? `Modified by ${task.modified_by === user?.id ? 'you' : task.modified_by_name}`
                              : task.created_by_name && `Created by ${task.created_by === user?.id ? 'you' : task.created_by_name}`
                            }
                          </span>


                        )}
                        {/* Tags Display */}
                        {task.tags?.map(tag => (
                          <span key={tag.id} className={`tag text-[9px] px-1.5 py-0.5 border border-transparent ${tag.color === 'blue' ? 'bg-blue-100 text-blue-700' :
                            tag.color === 'red' ? 'bg-red-100 text-red-700' :
                              tag.color === 'green' ? 'bg-green-100 text-green-700' :
                                tag.color === 'amber' ? 'bg-amber-100 text-amber-700' :
                                  tag.color === 'purple' ? 'bg-purple-100 text-purple-700' :
                                    'bg-gray-100 text-gray-700'
                            }`}>
                            {tag.name}
                          </span>
                        ))}
                      </div>
                    </div>
                    {/* Tag Button - Persistent next to right chevron if we want it there, 
                         User said "right side next to the reminder button".
                         In this view, there is no reminder button for tasks.
                         So placing it before the chevron. */}
                    <div className="relative">
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          if (activeTagPicker?.taskId === task.id && !activeTagPicker?.subtaskId) {
                            setActiveTagPicker(null)
                          } else {
                            const rect = e.currentTarget.getBoundingClientRect()
                            setActiveTagPicker({
                              taskId: task.id,
                              position: { top: rect.bottom + 8, right: window.innerWidth - rect.right }
                            })
                          }
                        }}
                        className={`p-1 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors ${activeTagPicker?.taskId === task.id && !activeTagPicker?.subtaskId ? 'bg-gray-100 text-gray-900' : ''}`}
                        title="Add Tag"
                      >
                        <Tag className="w-4 h-4" />
                      </button>
                      {activeTagPicker?.taskId === task.id && !activeTagPicker?.subtaskId && (
                        <TagPicker
                          tags={tags}
                          assignedTagIds={new Set((task.tags || []).map(t => t.id))}
                          onAssign={(tagId) => assignTag(task.id, tagId)}
                          onUnassign={(tagId) => unassignTag(task.id, tagId)}
                          onCreate={createTag}
                          onEdit={editTag}
                          onDelete={deleteTag}
                          onClose={() => setActiveTagPicker(null)}
                          position={activeTagPicker.position}
                        />
                      )}
                    </div>
                    {!isSelectionMode && <ChevronRight className="w-4 h-4 sm:w-5 sm:h-5 text-gray-400 flex-shrink-0" />}
                  </div>
                </div>

                {/* Collapsible Subtasks */}
                {
                  hasSubtasks && isExpanded && (
                    <div className="border-t border-gray-100 bg-gray-50/50 rounded-b-xl px-3 sm:px-4 py-2 space-y-1.5">
                      {task.subtasks.map(subtask => {
                        const subtaskOverdue = isOverdue(subtask.reminder_date) && !subtask.is_completed
                        const isSharedProject = project.owner_id !== user?.id || project.project_members?.length > 0
                        return (
                          <div
                            key={subtask.id}
                            className={`flex items-center gap-2 py-1.5 px-2 rounded-lg ${subtaskOverdue && !isCompleted ? 'bg-red-50' : ''}`}
                          >
                            <button
                              onClick={() => !isCompleted && toggleSubtask(project.id, stageIndex, task.id, subtask.id)}
                              className={`checkbox-custom flex-shrink-0 ${subtask.is_completed ? 'checked' : ''} ${isCompleted ? 'cursor-not-allowed' : ''}`}
                              style={{ width: 16, height: 16 }}
                              disabled={isCompleted}
                            >
                              {subtask.is_completed && <Check className="w-2.5 h-2.5" />}
                            </button>
                            <div className="flex-1 min-w-0 flex items-center gap-2">
                              <span className={`text-sm truncate ${subtask.is_completed ? 'line-through text-gray-400' : subtaskOverdue ? 'text-red-700' : 'text-gray-700'}`}>
                                {subtask.title}
                              </span>
                              {/* Subtask Tags Pills */}
                              {subtask.tags?.length > 0 && (
                                <div className="flex flex-wrap gap-1">
                                  {subtask.tags.map(tag => {
                                    const colorMap = {
                                      blue: 'bg-blue-100 text-blue-700',
                                      green: 'bg-green-100 text-green-700',
                                      red: 'bg-red-100 text-red-700',
                                      amber: 'bg-amber-100 text-amber-700',
                                      purple: 'bg-purple-100 text-purple-700',
                                      pink: 'bg-pink-100 text-pink-700',
                                      indigo: 'bg-indigo-100 text-indigo-700',
                                      gray: 'bg-gray-100 text-gray-700'
                                    }
                                    const colorClasses = colorMap[tag.color] || colorMap.blue
                                    return (
                                      <span key={tag.id} className={`px-1.5 py-0.5 rounded text-[9px] font-medium ${colorClasses}`}>
                                        {tag.name}
                                      </span>
                                    )
                                  })}
                                </div>
                              )}

                              {isSharedProject && (subtask.created_by_name || subtask.modified_by_name) && (
                                <span className="text-[10px] text-gray-400 ml-2">
                                  {subtask.modified_by_name && subtask.updated_at !== subtask.created_at
                                    ? `by ${subtask.modified_by === user?.id ? 'you' : subtask.modified_by_name}`
                                    : subtask.created_by_name && `by ${subtask.created_by === user?.id ? 'you' : subtask.created_by_name}`
                                  }
                                </span>
                              )}
                            </div>

                            {/* Subtask Tag Button */}
                            {!isCompleted && (
                              <div className="relative">
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    if (activeTagPicker?.subtaskId === subtask.id) {
                                      setActiveTagPicker(null)
                                    } else {
                                      const rect = e.currentTarget.getBoundingClientRect()
                                      setActiveTagPicker({
                                        taskId: task.id,
                                        subtaskId: subtask.id,
                                        position: { top: rect.bottom + 8, right: window.innerWidth - rect.right }
                                      })
                                    }
                                  }}
                                  className={`p-1 rounded hover:bg-gray-200 text-gray-400 hover:text-gray-600 transition-colors ${activeTagPicker?.subtaskId === subtask.id ? 'bg-gray-200 text-gray-900' : ''}`}
                                  title="Add Tag"
                                >
                                  <Tag className="w-3 h-3" />
                                </button>
                                {activeTagPicker?.subtaskId === subtask.id && (
                                  <TagPicker
                                    tags={tags}
                                    assignedTagIds={new Set((subtask.tags || []).map(t => t.id))}
                                    onAssign={(tagId) => assignTag(task.id, tagId, subtask.id)}
                                    onUnassign={(tagId) => unassignTag(task.id, tagId, subtask.id)}
                                    onCreate={createTag}
                                    onEdit={editTag}
                                    onDelete={deleteTag}
                                    onClose={() => setActiveTagPicker(null)}
                                    position={activeTagPicker.position}
                                  />
                                )}
                              </div>
                            )}

                            {!isCompleted && (
                              <ReminderPicker
                                value={subtask.reminder_date}
                                onChange={(date, scope) => updateSubtaskReminder(project.id, stageIndex, task.id, subtask.id, date, scope)}
                                compact
                                isShared={isSharedProject}
                              />
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )
                }
              </div>
            )
          })}

        </div>
      )}
    </div>
  )
}



// ============================================
// MAIN APP
// ============================================
// Error boundary to catch render-time exceptions and show a helpful message
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { error: null, info: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    derr('React render error:', error, info)
    this.setState({ error, info })
  }

  render() {
    if (this.state.error) {
      return (
        <div className="p-6">
          <h2 className="text-lg font-bold text-red-600">An error occurred while rendering the app</h2>
          <pre className="mt-3 text-sm text-gray-700 whitespace-pre-wrap">{String(this.state.error)}</pre>
          <details className="mt-2 text-xs text-gray-500">
            <summary>Stack / info</summary>
            <pre className="whitespace-pre-wrap">{this.state.info?.componentStack}</pre>
          </details>
        </div>
      )
    }
    return this.props.children
  }
}

function AppContent() {
  const { user, loading: authLoading, demoMode } = useAuth()
  const [projects, setProjects] = useState([])
  const [selectedProject, setSelectedProject] = useState(null)
  const [selectedTask, setSelectedTask] = useState(null)
  const [activeTab, setActiveTab] = useState('projects')
  const [view, setView] = useState('main')
  const [loading, setLoading] = useState(true)
  const [notifications, setNotifications] = useState([])
  const notificationsRef = useRef(notifications)
  const notifiedOverdueRef = useRef(new Set())
  const dismissedNotificationsRef = useRef(new Set()) // Tracks cleared/deleted notification keys to prevent regeneration
  const deletedProjectIdsRef = useRef(new Set()) // Guard: prevents realtime from resurrecting deleted projects
  const deletedTaskIdsRef = useRef(new Set()) // Guard: prevents realtime from resurrecting deleted tasks
  const [notificationSettings, setNotificationSettings] = useState({}) // Granular notification preferences
  const [walkVisible, setWalkVisible] = useState(false)
  // Today / focus state (persisted per user, not per-day)
  const getTodayKey = (d = new Date()) => `hypothesys_today_${user?.id || 'anon'}_permanent`
  const [todayItems, setTodayItems] = useState([]) // {id, title, projectId ?, taskId ?, isLocal, created_at}
  const todayUpdatedAtRef = useRef(null)
  const todayLoadedRef = useRef(false) // Track if we've loaded this user's data this session
  const [duplicateCheck, setDuplicateCheck] = useState(null) // { item, existingItem, type: 'task'|'subtask'|'local' }
  const [toast, setToast] = useState(null)
  const [toastVisible, setToastVisible] = useState(false)

  // Tags State
  const [tags, setTags] = useState([])
  const [isLoadingTags, setIsLoadingTags] = useState(false)
  const [activeTagPicker, setActiveTagPicker] = useState(null) // { taskId, subtaskId? }

  // Load Tags
  useEffect(() => {
    const loadTags = async () => {
      setIsLoadingTags(true)
      if (demoMode) {
        try {
          const raw = localStorage.getItem(TAGS_STORAGE_KEY)
          if (raw) setTags(JSON.parse(raw))
        } catch (e) { console.error('Error loading local tags', e) }
      } else if (user) {
        const { data } = await db.getTags(user.id)
        if (data) setTags(data)
      }
      setIsLoadingTags(false)
    }
    loadTags()
  }, [user, demoMode])

  // Save local tags helper
  const saveTagsLocal = (newTags) => {
    setTags(newTags)
    localStorage.setItem(TAGS_STORAGE_KEY, JSON.stringify(newTags))
  }

  const createTag = async (name, color) => {
    const newTag = {
      id: uuid(),
      user_id: user?.id || 'anon',
      name,
      color,
      created_at: new Date().toISOString()
    }

    if (demoMode) {
      saveTagsLocal([...tags, newTag])
      return newTag
    } else {
      const { data, error } = await db.createTag({
        user_id: user.id,
        name,
        color
      })
      if (data) {
        setTags([...tags, data])
        return data
      }
      return null
    }
  }

  const editTag = async (tagId, newName, newColor) => {
    const updatedTag = { id: tagId, name: newName, color: newColor }

    // Update in tags list
    const newTags = tags.map(t => t.id === tagId ? { ...t, name: newName, color: newColor } : t)
    setTags(newTags)

    // Update in all projects (tasks and subtasks that have this tag)
    const newProjects = projects.map(p => ({
      ...p,
      stages: p.stages.map(s => ({
        ...s,
        tasks: s.tasks.map(t => ({
          ...t,
          tags: t.tags?.map(tag => tag.id === tagId ? { ...tag, name: newName, color: newColor } : tag) || [],
          subtasks: t.subtasks?.map(st => ({
            ...st,
            tags: st.tags?.map(tag => tag.id === tagId ? { ...tag, name: newName, color: newColor } : tag) || []
          })) || []
        }))
      }))
    }))
    setProjects(newProjects)

    if (demoMode) {
      saveTagsLocal(newTags)
      saveLocal(newProjects)
    } else {
      await db.updateTag(tagId, { name: newName, color: newColor })
    }
  }

  const deleteTag = async (tagId) => {
    // Remove from tags list
    const newTags = tags.filter(t => t.id !== tagId)
    setTags(newTags)

    // Remove from all projects (tasks and subtasks)
    const newProjects = projects.map(p => ({
      ...p,
      stages: p.stages.map(s => ({
        ...s,
        tasks: s.tasks.map(t => ({
          ...t,
          tags: t.tags?.filter(tag => tag.id !== tagId) || [],
          subtasks: t.subtasks?.map(st => ({
            ...st,
            tags: st.tags?.filter(tag => tag.id !== tagId) || []
          })) || []
        }))
      }))
    }))
    setProjects(newProjects)

    if (demoMode) {
      saveTagsLocal(newTags)
      saveLocal(newProjects)
    } else {
      await db.deleteTag(tagId)
    }
  }

  const assignTag = async (taskId, tagId, subtaskId = null) => {
    // Optimistic update in UI 
    const tag = tags.find(t => t.id === tagId)
    if (!tag) return

    const now = new Date().toISOString()
    const userName = user?.user_metadata?.name || user?.email || 'Unknown'

    const updateProjectWithTag = (p) => {
      return {
        ...p,
        stages: p.stages.map(s => ({
          ...s,
          tasks: s.tasks.map(t => {
            if (t.id === taskId) {
              if (subtaskId) {
                // Update subtask
                return {
                  ...t,
                  updated_at: now,
                  modified_by: user?.id,
                  modified_by_name: userName,
                  subtasks: t.subtasks?.map(st => {
                    if (st.id === subtaskId) {
                      const existing = st.tags || []
                      if (existing.some(et => et.id === tagId)) return st
                      return { ...st, tags: [...existing, tag], updated_at: now, modified_by: user?.id, modified_by_name: userName }
                    }
                    return st
                  }) || []
                }
              } else {
                // Update task
                const existingTags = t.tags || []
                if (existingTags.some(et => et.id === tagId)) return t
                return { ...t, tags: [...existingTags, tag], updated_at: now, modified_by: user?.id, modified_by_name: userName }
              }
            }
            return t
          })
        }))
      }
    }

    const newProjects = projects.map(updateProjectWithTag)
    setProjects(newProjects)
    if (demoMode) saveLocal(newProjects)

    if (!demoMode) {
      if (subtaskId) {
        await db.addTagToSubtask(subtaskId, tagId)
        await db.updateSubtask(subtaskId, { modified_by: user?.id })
      } else {
        await db.addTagToTask(taskId, tagId)
        await db.updateTask(taskId, { modified_by: user?.id })
      }
    }
  }

  const unassignTag = async (taskId, tagId, subtaskId = null) => {
    const now = new Date().toISOString()
    const userName = user?.user_metadata?.name || user?.email || 'Unknown'

    const updateProjectRemoveTag = (p) => {
      return {
        ...p,
        stages: p.stages.map(s => ({
          ...s,
          tasks: s.tasks.map(t => {
            if (t.id === taskId) {
              if (subtaskId) {
                return {
                  ...t,
                  updated_at: now,
                  modified_by: user?.id,
                  modified_by_name: userName,
                  subtasks: t.subtasks?.map(st => {
                    if (st.id === subtaskId) {
                      const existing = st.tags || []
                      return { ...st, tags: existing.filter(et => et.id !== tagId), updated_at: now, modified_by: user?.id, modified_by_name: userName }
                    }
                    return st
                  }) || []
                }
              } else {
                const existingTags = t.tags || []
                return { ...t, tags: existingTags.filter(et => et.id !== tagId), updated_at: now, modified_by: user?.id, modified_by_name: userName }
              }
            }
            return t
          })
        }))
      }
    }

    const newProjects = projects.map(updateProjectRemoveTag)
    setProjects(newProjects)
    if (demoMode) saveLocal(newProjects)

    if (!demoMode) {
      if (subtaskId) {
        await db.removeTagFromSubtask(subtaskId, tagId)
        await db.updateSubtask(subtaskId, { modified_by: user?.id })
      } else {
        await db.removeTagFromTask(taskId, tagId)
        await db.updateTask(taskId, { modified_by: user?.id })
      }
    }
  }

  // load today's items: prefer server when available, migrate legacy localStorage if needed
  useEffect(() => {
    (async () => {
      try {
        const key = getTodayKey()

        const parseLocal = () => {
          const rawLocal = localStorage.getItem(key)
          if (!rawLocal) return null
          try {
            const parsed = JSON.parse(rawLocal)
            if (Array.isArray(parsed)) return { items: parsed, updated_at: null }
            if (parsed && Array.isArray(parsed.items)) return { items: parsed.items, updated_at: parsed.updated_at || null }
          } catch (e) { }
          return null
        }

        const localPayload = parseLocal()
        let serverPayload = null

        // On initial load (user just logged in), fetch from server to sync
        // On subsequent page reloads within same session, trust localStorage unless realtime tells us otherwise
        const isInitialLoad = !todayLoadedRef.current
        if (isInitialLoad && !demoMode && user && db && db.getTodayItems) {
          try {
            const { data, error } = await db.getTodayItems(user.id)
            if (!error && data && Array.isArray(data.items)) {
              serverPayload = { items: data.items, updated_at: data.updated_at || null }
            }
          } catch (e) { }
        }

        const serverTime = serverPayload?.updated_at ? new Date(serverPayload.updated_at).getTime() : -Infinity
        const localTime = localPayload?.updated_at ? new Date(localPayload.updated_at).getTime() : -Infinity

        // Prefer server on FIRST load (initial sync), then always prefer local until realtime updates
        const chosen = isInitialLoad ? (serverTime >= localTime ? serverPayload : (localPayload || serverPayload)) : (localPayload || serverPayload)

        if (chosen && Array.isArray(chosen.items)) {
          const updatedAt = chosen.updated_at || new Date().toISOString()
          todayUpdatedAtRef.current = updatedAt
          todayLoadedRef.current = true // Mark as loaded for this user
          setTodayItems(chosen.items)
          try { localStorage.setItem(key, JSON.stringify({ items: chosen.items, updated_at: updatedAt })) } catch (e) { }
          return
        }

        // Notifications Migration
        const legacyNotifs = localStorage.getItem('researchos_notifications')
        if (legacyNotifs) {
          localStorage.setItem('hypothesys_notifications', legacyNotifs)
          localStorage.removeItem('researchos_notifications')
        }

        todayLoadedRef.current = true
        setTodayItems([])
      } catch (e) {
        todayLoadedRef.current = true
        setTodayItems([])
      }
    })()

    return () => {
      // Clear loaded flag when user changes (logout/login) so next user gets a fresh sync
      if (!user) {
        todayLoadedRef.current = false
        setTodayItems([])
      }
    }
  }, [user])

  const saveTodayItems = async (items) => {
    const updated_at = new Date().toISOString()
    const payload = { items, updated_at }
    todayUpdatedAtRef.current = updated_at

    try {
      const key = getTodayKey()
      localStorage.setItem(key, JSON.stringify(payload))
    } catch (e) { }

    // persist to server if available and user signed in
    if (!demoMode && user && db && db.saveTodayItems) {
      try {
        // Pass the client timestamp to the server so it uses OUR timestamp for conflict resolution
        const { error, data } = await db.saveTodayItems(user.id, items, updated_at)
        if (!error && data?.updated_at) {
          // Server should echo back our timestamp, confirming the save
          todayUpdatedAtRef.current = data.updated_at
          const key = getTodayKey()
          try { localStorage.setItem(key, JSON.stringify({ items, updated_at: data.updated_at })) } catch (e) { }
        }
        if (error) {
          try { console.warn('Failed to save today items to server', error) } catch (_) { }
        }
      } catch (e) {
        try { console.warn('Failed to save today items to server', e) } catch (_) { }
      }
    }
  }

  const showToast = (message, ms = 2500) => {
    try {
      const id = uuid()
      setToast({ id, message })
      // show then hide with small exit animation window
      setToastVisible(true)
      const hideAt = Math.max(300, ms - 220)
      setTimeout(() => setToastVisible(false), hideAt)
      setTimeout(() => {
        setToast(current => (current && current.id === id ? null : current))
      }, ms)
    } catch (e) { }
  }

  const addToToday = async (task, opts = {}) => {
    if (!task) return
    // Prevent duplicates: consider legacy linked items (taskId) and copied items (sourceTaskId)
    const exists = todayItems.find(i => i.taskId === task.id || i.sourceTaskId === task.id)
    if (exists) {
      setDuplicateCheck({
        item: task,
        existingItem: exists,
        type: 'task',
        opts
      })
      return
    }
    // Create a local copy of the task so edits don't affect the original
    const item = {
      id: uuid(),
      title: task.title,
      projectId: opts.projectId || null,
      isLocal: true,
      sourceTaskId: task.id,
      tags: task.tags || [],
      reminder_date: task.reminder_date || null,
      created_at: new Date().toISOString()
    }
    const next = appendTodayItem(todayItems, item)
    setTodayItems(next)
    await saveTodayItems(next)
    persistTodayToServer(next)
  }

  // Helper to place new items correctly (now prepends to top)
  const appendTodayItem = (current, item) => {
    return [item, ...current]
  }

  const persistTodayToServer = async (next) => {
    try {
      if (!demoMode && user && db && db.saveTodayItems) {
        const { error } = await db.saveTodayItems(user.id, next)
        if (error) {
          showToast('Failed to sync to server: ' + (error.message || error))
        }
      }
    } catch (e) {
      dwarn('persistTodayToServer failed', e)
    }
  }

  const handleDuplicateAction = (action, check) => {
    const { item, existingItem, type, opts } = check
    setDuplicateCheck(null)

    if (action === 'cancel') return

    if (action === 'reactivate') {
      toggleTodayDone(existingItem.id) // This handles both local and server sync
      showToast('Task reactivated')
      return
    }

    if (action === 'duplicate') {
      const newItem = {
        id: uuid(),
        title: type === 'local' ? item.title : (type === 'subtask' ? `${opts.parentTitle} — ${item.title}` : item.title),
        projectId: opts?.projectId || null,
        isLocal: true,
        sourceTaskId: type === 'task' ? item.id : (type === 'subtask' ? opts.parentTaskId : null),
        sourceSubtaskId: type === 'subtask' ? item.id : null,
        tags: item.tags || [],
        reminder_date: item.reminder_date || null,
        created_at: new Date().toISOString()
      }
      const next = appendTodayItem(todayItems, newItem)
      setTodayItems(next)
      saveTodayItems(next)
      persistTodayToServer(next)
      showToast('Duplicate added')
    }
  }

  const addSubtaskToToday = async (subtask, parentTask, opts = {}) => {
    if (!subtask || !parentTask) return
    // Prevent duplicates: consider legacy linked items and copied items
    const exists = todayItems.find(i => i.subtaskId === subtask.id || i.sourceSubtaskId === subtask.id || (i.taskId === parentTask.id || i.sourceTaskId === parentTask.id) && i.title === `${parentTask.title} — ${subtask.title}`)
    if (exists) {
      setDuplicateCheck({
        item: subtask,
        existingItem: exists,
        type: 'subtask',
        opts: { ...opts, parentTaskId: parentTask.id, parentTitle: parentTask.title }
      })
      return
    }
    // Create a local copy of the subtask so edits don't affect the original
    const item = {
      id: uuid(),
      title: `${parentTask.title} — ${subtask.title}`,
      projectId: opts.projectId || null,
      isLocal: true,
      sourceTaskId: parentTask.id,
      sourceSubtaskId: subtask.id,
      tags: subtask.tags || [],
      reminder_date: subtask.reminder_date || null,
      created_at: new Date().toISOString()
    }
    const next = appendTodayItem(todayItems, item)
    setTodayItems(next)
    await saveTodayItems(next)
    persistTodayToServer(next)
  }

  const addLocalTodayTask = async (title) => {
    if (!title || !title.trim()) return
    const trimmed = title.trim()
    const exists = todayItems.find(i => i.isLocal && i.title === trimmed)
    if (exists) {
      setDuplicateCheck({
        item: { title: trimmed },
        existingItem: exists,
        type: 'local'
      })
      return
    }
    const item = { id: uuid(), title: trimmed, isLocal: true, is_done: false, created_at: new Date().toISOString() }
    const next = appendTodayItem(todayItems, item)
    setTodayItems(next)
    await saveTodayItems(next)
    persistTodayToServer(next)
  }

  const toggleTodayDone = async (id) => {
    const item = todayItems.find(i => i.id === id)
    if (!item) return

    const currentlyDone = !!item.is_done
    const newDone = !currentlyDone
    const now = new Date().toISOString()

    // 1. Optimistically update Today items
    const updatedItem = { ...item, is_done: newDone, completed_at: newDone ? now : null }
    const remaining = todayItems.filter(i => i.id !== id)
    const active = newDone ? remaining.filter(i => !i.is_done) : [updatedItem, ...remaining.filter(i => !i.is_done)]
    const completed = newDone ? [...remaining.filter(i => i.is_done), updatedItem] : remaining.filter(i => i.is_done)
    const completedSorted = [...completed].sort((a, b) => new Date(b.completed_at || b.updated_at || b.created_at || 0) - new Date(a.completed_at || a.updated_at || a.created_at || 0))
    const next = [...active, ...completedSorted]

    setTodayItems(next)
    await saveTodayItems(next)

    // 2. If it's a local-only item, we are done
    if (item.isLocal) return

    // 3. For linked items, update the Projects state (for both Demo and Real modes)
    // This ensures "Modified" and "Completion" status is reflected immediately in Project views
    const userName = user?.user_metadata?.name || user?.email || 'Unknown'
    const userId = user?.id

    let projectsUpdated = false
    const newProjects = projects.map(p => {
      // Deep map to find the task/subtask and update it
      let projectChanged = false
      const newStages = (p.stages || []).map(s => {
        const newTasks = (s.tasks || []).map(t => {
          // Case A: Linked Task
          if (item.taskId && t.id === item.taskId) {
            projectChanged = true
            return {
              ...t,
              is_completed: newDone,
              updated_at: now,
              modified_by: userId,
              modified_by_name: userName
            }
          }
          // Case B: Linked Subtask (Task is parent)
          if (item.subtaskId && t.subtasks && t.subtasks.some(st => st.id === item.subtaskId)) {
            // Sync the subtask state locally
            const newSubtasks = t.subtasks.map(st =>
              st.id === item.subtaskId ? { ...st, is_completed: newDone, updated_at: now } : st
            )
            projectChanged = true
            // Note: updating subtask updates task's updated_at too logic-wise
            return {
              ...t,
              subtasks: newSubtasks,
              updated_at: now,
              modified_by: userId,
              modified_by_name: userName
            }
          }
          return t
        })
        return { ...s, tasks: newTasks }
      })

      if (projectChanged) {
        projectsUpdated = true
        return {
          ...p,
          stages: newStages,
          updated_at: now,
          modified_by: userId,
          modified_by_name: userName
        }
      }
      return p
    })

    if (projectsUpdated) {
      setProjects(newProjects)
      if (demoMode) saveLocal(newProjects)
    }

    // 4. Server Update (Real Mode)
    if (!demoMode) {
      if (item.subtaskId) {
        const { error } = await db.updateSubtask(item.subtaskId, { is_completed: newDone })
        if (error) {
          dwarn('Failed to update subtask completion:', error)
          showToast('Failed to update subtask')
        }
      } else if (item.taskId) {
        const { error } = await db.updateTask(item.taskId, { is_completed: newDone })
        if (error) {
          dwarn('Failed to update task completion:', error)
          showToast('Failed to update task')
        }
      }
      // Note: We don't force-fetch getProjects here because we optimistically updated
    }
  }

  const removeTodayItem = async (id) => {
    const next = todayItems.filter(i => i.id !== id)
    setTodayItems(next)
    await saveTodayItems(next)
  }

  const removeTodayItems = async (ids = []) => {
    if (!ids || ids.length === 0) return
    const idSet = new Set(ids)
    const next = todayItems.filter(i => !idSet.has(i.id))
    setTodayItems(next)
    await saveTodayItems(next)
  }

  const duplicateTodayItems = async (ids = []) => {
    if (!ids || ids.length === 0) return
    // Process in reverse order to maintain correct indices after each insertion
    const sortedIds = [...ids].sort((a, b) => {
      const aIdx = todayItems.findIndex(i => i.id === a)
      const bIdx = todayItems.findIndex(i => i.id === b)
      return bIdx - aIdx // Descending order so we insert from bottom to top
    })
    let next = [...todayItems]
    for (const id of sortedIds) {
      const idx = next.findIndex(i => i.id === id)
      if (idx !== -1) {
        const item = next[idx]
        const copy = { ...item, id: uuid(), created_at: new Date().toISOString(), is_done: false }
        next.splice(idx + 1, 0, copy)
      }
    }
    setTodayItems(next)
    await saveTodayItems(next)
  }

  const reorderToday = async (fromIndex, toIndex) => {
    const items = [...todayItems]
    const [moved] = items.splice(fromIndex, 1)
    items.splice(toIndex, 0, moved)
    setTodayItems(items)
    await saveTodayItems(items)
  }

  const reorderTasks = async (projectId, stageIndex, fromIndex, toIndex) => {
    const project = projects.find(p => p.id === projectId)
    if (!project || !project.stages[stageIndex]) return

    const sortFn = (a, b) => {
      if (a.is_completed !== b.is_completed) return a.is_completed ? 1 : -1
      if ((a.order_index || 0) !== (b.order_index || 0)) return (a.order_index || 0) - (b.order_index || 0)
      return new Date(b.created_at || 0) - new Date(a.created_at || 0)
    }

    const newProjects = projects.map(p => {
      if (p.id !== projectId) return p
      const stages = p.stages.map((s, si) => {
        if (si !== stageIndex) return s
        const tasks = [...s.tasks].sort(sortFn)
        const [moved] = tasks.splice(fromIndex, 1)
        tasks.splice(toIndex, 0, moved)
        return { ...s, tasks: tasks.map((t, idx) => ({ ...t, order_index: idx })) }
      })
      return { ...p, stages }
    })

    setProjects(newProjects)
    if (demoMode) saveLocal(newProjects)

    if (!demoMode) {
      const stage = project.stages[stageIndex]
      const tasks = [...stage.tasks].sort(sortFn)
      const [moved] = tasks.splice(fromIndex, 1)
      tasks.splice(toIndex, 0, moved)
      // Bulk update order_index in background for performance
      const updates = tasks.map((t, idx) => ({ id: t.id, order_index: idx }))
      const { error } = await db.bulkUpdateTasks(updates)
      if (error) dwarn('reorderTasks sync failed', error)
    }
  }

  const reorderSubtasks = async (projectId, stageIndex, taskId, fromIndex, toIndex) => {
    const project = projects.find(p => p.id === projectId)
    if (!project) return

    const sortFn = (a, b) => {
      if (a.is_completed !== b.is_completed) return a.is_completed ? 1 : -1
      if ((a.order_index || 0) !== (b.order_index || 0)) return (a.order_index || 0) - (b.order_index || 0)
      return new Date(a.created_at || 0) - new Date(b.created_at || 0)
    }

    const newProjects = projects.map(p => {
      if (p.id !== projectId) return p
      const stages = p.stages.map((s, si) => {
        if (si !== stageIndex) return s
        const tasks = s.tasks.map(t => {
          if (t.id !== taskId) return t
          const subtasks = [...(t.subtasks || [])].sort(sortFn)
          const [moved] = subtasks.splice(fromIndex, 1)
          subtasks.splice(toIndex, 0, moved)
          return { ...t, subtasks: subtasks.map((st, idx) => ({ ...st, order_index: idx })) }
        })
        return { ...s, tasks }
      })
      return { ...p, stages }
    })

    setProjects(newProjects)
    if (demoMode) saveLocal(newProjects)

    if (!demoMode) {
      const stage = project.stages[stageIndex]
      const task = stage.tasks.find(t => t.id === taskId)
      if (task) { // Keep the check for task existence
        const subtasks = [...(task.subtasks || [])].sort(sortFn)
        const [moved] = subtasks.splice(fromIndex, 1)
        subtasks.splice(toIndex, 0, moved)
        // Bulk update order_index in background for performance
        const updates = subtasks.map((st, idx) => ({ id: st.id, order_index: idx }))
        db.bulkUpdateSubtasks(updates).catch(e => dwarn('reorderSubtasks sync failed', e))
      }
    }
  }

  const moveTaskBetweenStages = async ({ sourceProjectId, sourceStageIndex, taskId, targetProjectId, targetStageIndex }) => {
    const sourceProject = projects.find(p => p.id === sourceProjectId)
    const targetProject = projects.find(p => p.id === targetProjectId)
    if (!sourceProject || !targetProject) return

    const sourceStage = sourceProject.stages?.[sourceStageIndex]
    const targetStage = targetProject.stages?.[targetStageIndex]
    if (!sourceStage || !targetStage) return

    const sourceTask = sourceStage.tasks?.find(task => task.id === taskId)
    if (!sourceTask) return

    const now = new Date().toISOString()
    const userName = user?.user_metadata?.name || user?.email || 'Unknown'
    const sameStage = sourceProjectId === targetProjectId && sourceStageIndex === targetStageIndex

    const normalizeTasks = (tasks, stageId) => tasks.map((task, index) => ({
      ...task,
      stage_id: stageId,
      order_index: index,
      updated_at: now,
      modified_by: user?.id,
      modified_by_name: userName
    }))

    const updatedProjects = projects.map(project => {
      let changed = false
      const updatedStages = (project.stages || []).map((stage, stageIndex) => {
        const isSourceStage = project.id === sourceProjectId && stageIndex === sourceStageIndex
        const isTargetStage = project.id === targetProjectId && stageIndex === targetStageIndex
        if (!isSourceStage && !isTargetStage) return stage

        changed = true

        if (sameStage && isSourceStage) {
          const reordered = [sourceTask, ...(stage.tasks || []).filter(task => task.id !== taskId)]
          return { ...stage, tasks: normalizeTasks(reordered, stage.id) }
        }

        if (isSourceStage) {
          const remaining = (stage.tasks || []).filter(task => task.id !== taskId)
          return { ...stage, tasks: normalizeTasks(remaining, stage.id) }
        }

        if (isTargetStage) {
          const inserted = [sourceTask, ...(stage.tasks || []).filter(task => task.id !== taskId)]
          return { ...stage, tasks: normalizeTasks(inserted, stage.id) }
        }

        return stage
      })

      if (!changed) return project
      return {
        ...project,
        stages: updatedStages,
        updated_at: now,
        modified_by: user?.id,
        modified_by_name: userName
      }
    })

    setProjects(updatedProjects)
    if (demoMode) {
      saveLocal(updatedProjects)
      return
    }

    const movedTaskUpdates = {
      stage_id: targetStage.id,
      order_index: 0,
      modified_by: user?.id,
      updated_at: now
    }
    await db.updateTask(taskId, movedTaskUpdates)

    const sourceAfter = updatedProjects.find(project => project.id === sourceProjectId)?.stages?.[sourceStageIndex]?.tasks || []
    const targetAfter = updatedProjects.find(project => project.id === targetProjectId)?.stages?.[targetStageIndex]?.tasks || []
    const stageUpdates = sameStage ? targetAfter : [...sourceAfter, ...targetAfter]
    const uniqueUpdates = new Map(stageUpdates.map(task => [task.id, { id: task.id, order_index: task.order_index }]))
    const { error } = await db.bulkUpdateTasks([...uniqueUpdates.values()])
    if (error) {
      dwarn('moveTaskBetweenStages sync failed', error)
    }
  }

  // Keep ref in sync
  useEffect(() => {
    notificationsRef.current = notifications
    // keep notifiedOverdueRef in sync for existing overdue notifications
    try {
      const set = new Set()
        (notifications || []).forEach(n => {
          if (n.type === 'task_overdue' && n.task_id) set.add(`task-${n.task_id}`)
          if (n.type === 'subtask_overdue' && n.task_id && n.subtask_id) set.add(`subtask-${n.task_id}-${n.subtask_id}`)
        })
      notifiedOverdueRef.current = set
    } catch (e) { }
  }, [notifications])

  // Load notifications
  const loadNotifications = async () => {
    if (demoMode) {
      // Load from localStorage for demo
      try {
        const stored = localStorage.getItem('hypothesys_notifications')
        const parsed = stored ? JSON.parse(stored) : []
        setNotifications(parsed)
        // populate notifiedOverdueRef from stored notifications
        try {
          const set = new Set()
          parsed.forEach(n => {
            if (n.type === 'task_overdue' && n.task_id) set.add(`task-${n.task_id}`)
            if (n.type === 'subtask_overdue' && n.task_id && n.subtask_id) set.add(`subtask-${n.task_id}-${n.subtask_id}`)
          })
          notifiedOverdueRef.current = set
        } catch (e) { }
      } catch {
        setNotifications([])
      }
      return
    }

    if (user) {
      const { data } = await db.getNotifications(user.id)
      const parsed = data || []
      setNotifications(parsed)
      try {
        const set = new Set()
        parsed.forEach(n => {
          if (n.type === 'task_overdue' && n.task_id) set.add(`task-${n.task_id}`)
          if (n.type === 'subtask_overdue' && n.task_id && n.subtask_id) set.add(`subtask-${n.task_id}-${n.subtask_id}`)
        })
        notifiedOverdueRef.current = set
      } catch (e) { }
      // Load dismissed keys from localStorage
      try {
        const dismissedStored = localStorage.getItem('hypothesys_dismissed_notifications')
        if (dismissedStored) {
          dismissedNotificationsRef.current = new Set(JSON.parse(dismissedStored))
        }
      } catch (e) { }
    }
  }

  // Load notification settings
  const loadNotificationSettings = async () => {
    if (demoMode) {
      // Load from localStorage for demo
      try {
        const stored = localStorage.getItem('hypothesys_notification_settings')
        if (stored) setNotificationSettings(JSON.parse(stored))
      } catch { }
      return
    }

    if (user) {
      // Initialize settings if they don't exist, then load them
      const { data } = await db.initializeNotificationSettings(user.id)
      if (data) setNotificationSettings(data)
    }
  }

  // Update notification settings
  const updateNotificationSettings = async (updates) => {
    const newSettings = { ...notificationSettings, ...updates }
    setNotificationSettings(newSettings)

    if (demoMode) {
      localStorage.setItem('hypothesys_notification_settings', JSON.stringify(newSettings))
      return { error: null }
    }

    if (user) {
      const { error } = await db.updateNotificationSettings(user.id, updates)
      return { error }
    }
    return { error: null }
  }

  // Walkthrough: show on first login
  const WALK_KEY = 'hypothesys_walkthrough_seen_v1'
  useEffect(() => {
    if (!user) return
    try {
      const seen = localStorage.getItem(WALK_KEY)
      if (!seen) {
        // small delay so UI settles
        setTimeout(() => setWalkVisible(true), 700)
      }
    } catch (e) { }
  }, [user])

  // Check for overdue tasks and create notifications
  const checkOverdueTasks = (projectsList, existingNotifications, todayItemsList = []) => {
    const overdueTasks = []
    const overdueSubtasks = []
    const overdueTodayItems = []

    projectsList.forEach(project => {
      project.stages?.forEach((stage, stageIndex) => {
        stage.tasks?.forEach(task => {
          // Check if task is overdue
          if (task.reminder_date && isOverdue(task.reminder_date) && !task.is_completed) {
            overdueTasks.push({
              project,
              stage,
              stageIndex,
              task
            })
          }

          // Check subtasks
          task.subtasks?.forEach(subtask => {
            if (subtask.reminder_date && isOverdue(subtask.reminder_date) && !subtask.is_completed) {
              overdueSubtasks.push({
                project,
                stage,
                stageIndex,
                task,
                subtask
              })
            }
          })
        })
      })
    })

    // Check today items for overdue reminders
    todayItemsList.forEach(item => {
      if (item.reminder_date && isOverdue(item.reminder_date) && !item.is_done) {
        overdueTodayItems.push(item)
      }
    })

    // Prune notifiedOverdueRef for items that are no longer overdue or removed
    try {
      const currentTaskKeys = new Set(overdueTasks.map(o => `task-${o.task.id}`))
      const currentSubtaskKeys = new Set(overdueSubtasks.map(o => `subtask-${o.task.id}-${o.subtask.id}`))
      const currentTodayKeys = new Set(overdueTodayItems.map(o => `today-${o.id}`))
      const keep = new Set()
      notifiedOverdueRef.current.forEach(k => {
        if (k.startsWith('task-') && currentTaskKeys.has(k)) keep.add(k)
        if (k.startsWith('subtask-') && currentSubtaskKeys.has(k)) keep.add(k)
        if (k.startsWith('today-') && currentTodayKeys.has(k)) keep.add(k)
      })
      notifiedOverdueRef.current = keep
    } catch (e) { }

    // Create notifications for overdue items that don't already have one
    const newNotifications = []
    const existingNotifKeys = new Set(existingNotifications.map(n => `${n.type}-${n.task_id || ''}-${n.subtask_id || ''}`))

    overdueTasks.forEach(({ project, task }) => {
      const key = `task-${task.id}`
      const existingKey = `task_overdue-${task.id}-`
      // skip if already notified (in-memory set) or existing notifications include it
      if (!notifiedOverdueRef.current.has(key) && !existingNotifKeys.has(existingKey) && !dismissedNotificationsRef.current.has(existingKey)) {
        newNotifications.push({
          id: uuid(),
          type: 'task_overdue',
          title: `Task overdue: ${task.title}`,
          message: `${project.emoji} ${project.title} - ${formatReminderDate(task.reminder_date)}`,
          project_id: project.id,
          task_id: task.id,
          is_read: false,
          created_at: new Date().toISOString(),
          reminder_date: task.reminder_date
        })
        // mark as notified to avoid repeats
        try { notifiedOverdueRef.current.add(key) } catch (e) { }
      }
    })

    overdueSubtasks.forEach(({ project, task, subtask }) => {
      const key = `subtask-${task.id}-${subtask.id}`
      const existingKey = `subtask_overdue-${task.id}-${subtask.id}`
      if (!notifiedOverdueRef.current.has(key) && !existingNotifKeys.has(existingKey) && !dismissedNotificationsRef.current.has(existingKey)) {
        newNotifications.push({
          id: uuid(),
          type: 'subtask_overdue',
          title: `Subtask overdue: ${subtask.title}`,
          message: `${project.emoji} ${task.title} - ${formatReminderDate(subtask.reminder_date)}`,
          project_id: project.id,
          task_id: task.id,
          subtask_id: subtask.id,
          is_read: false,
          created_at: new Date().toISOString(),
          reminder_date: subtask.reminder_date
        })
        try { notifiedOverdueRef.current.add(key) } catch (e) { }
      }
    })

    overdueTodayItems.forEach((item) => {
      const key = `today-${item.id}`
      const existingKey = `today_overdue-${item.id}`
      if (!notifiedOverdueRef.current.has(key) && !existingNotifKeys.has(existingKey) && !dismissedNotificationsRef.current.has(existingKey)) {
        newNotifications.push({
          id: uuid(),
          type: 'today_overdue',
          title: `Tod(o)ay Task Overdue: ${item.title}`,
          message: `Reminder for: ${formatReminderDate(item.reminder_date)}`,
          today_item_id: item.id,
          is_read: false,
          created_at: new Date().toISOString(),
          reminder_date: item.reminder_date
        })
        try { notifiedOverdueRef.current.add(key) } catch (e) { }
      }
    })

    return newNotifications
  }

  // Effect to check for overdue tasks when projects change AND periodically
  useEffect(() => {
    if (projects.length === 0) return

    const runOverdueCheck = async () => {
      const currentNotifications = notificationsRef.current
      const newOverdueNotifications = checkOverdueTasks(projects, currentNotifications, todayItems)

      if (newOverdueNotifications.length > 0) {
        const allNotifications = [...newOverdueNotifications, ...currentNotifications]
        setNotifications(allNotifications)

        if (demoMode) {
          localStorage.setItem('hypothesys_notifications', JSON.stringify(allNotifications))
        } else {
          // Save new notifications to the database
          for (const notif of newOverdueNotifications) {
            await db.createNotification({
              ...notif,
              user_id: user?.id
            })
          }
        }
      }
    }

    // Run immediately
    runOverdueCheck()

    // Also run every 30 seconds to catch newly overdue items
    const interval = setInterval(runOverdueCheck, 30000)

    return () => clearInterval(interval)
  }, [projects, todayItems, demoMode, user?.id])

  // Notification handlers
  const handleMarkNotificationRead = async (id) => {
    if (demoMode) {
      const updated = notifications.map(n => n.id === id ? { ...n, is_read: true } : n)
      setNotifications(updated)
      localStorage.setItem('hypothesys_notifications', JSON.stringify(updated))
    } else {
      await db.markNotificationRead(id)
      setNotifications(notifications.map(n => n.id === id ? { ...n, is_read: true } : n))
    }
  }

  const handleMarkNotificationUnread = async (id) => {
    if (demoMode) {
      const updated = notifications.map(n => n.id === id ? { ...n, is_read: false } : n)
      setNotifications(updated)
      localStorage.setItem('hypothesys_notifications', JSON.stringify(updated))
    } else {
      await db.markNotificationUnread(id)
      setNotifications(notifications.map(n => n.id === id ? { ...n, is_read: false } : n))
    }
  }

  const handleMarkAllNotificationsRead = async () => {
    if (demoMode) {
      const updated = notifications.map(n => ({ ...n, is_read: true }))
      setNotifications(updated)
      localStorage.setItem('hypothesys_notifications', JSON.stringify(updated))
    } else {
      await db.markAllNotificationsRead(user.id)
      setNotifications(notifications.map(n => ({ ...n, is_read: true })))
    }
  }

  const handleDeleteNotification = async (id) => {
    // Track dismissed key to prevent regeneration
    const notif = notifications.find(n => n.id === id)
    if (notif) {
      const key = notif.type === 'task_overdue' && notif.task_id
        ? `task_overdue-${notif.task_id}`
        : notif.type === 'subtask_overdue' && notif.task_id && notif.subtask_id
          ? `subtask_overdue-${notif.task_id}-${notif.subtask_id}`
          : null
      if (key) {
        dismissedNotificationsRef.current.add(key)
        localStorage.setItem('hypothesys_dismissed_notifications', JSON.stringify([...dismissedNotificationsRef.current]))
      }
    }

    if (demoMode) {
      const updated = notifications.filter(n => n.id !== id)
      setNotifications(updated)
      localStorage.setItem('hypothesys_notifications', JSON.stringify(updated))
    } else {
      await db.deleteNotification(id)
      setNotifications(notifications.filter(n => n.id !== id))
    }
  }

  const handleDeleteMultipleNotifications = async (ids) => {
    if (demoMode) {
      const idsSet = new Set(ids)
      const updated = notifications.filter(n => !idsSet.has(n.id))
      setNotifications(updated)
      localStorage.setItem('hypothesys_notifications', JSON.stringify(updated))
    } else {
      // Delete each notification
      for (const id of ids) {
        await db.deleteNotification(id)
      }
      const idsSet = new Set(ids)
      setNotifications(notifications.filter(n => !idsSet.has(n.id)))
    }
  }

  const handleClearAllNotifications = async () => {
    // Track all current notification keys as dismissed
    notifications.forEach(notif => {
      const key = notif.type === 'task_overdue' && notif.task_id
        ? `task_overdue-${notif.task_id}`
        : notif.type === 'subtask_overdue' && notif.task_id && notif.subtask_id
          ? `subtask_overdue-${notif.task_id}-${notif.subtask_id}`
          : null
      if (key) dismissedNotificationsRef.current.add(key)
    })
    localStorage.setItem('hypothesys_dismissed_notifications', JSON.stringify([...dismissedNotificationsRef.current]))

    if (demoMode) {
      setNotifications([])
      localStorage.setItem('hypothesys_notifications', JSON.stringify([]))
    } else {
      await db.clearAllNotifications(user.id)
      setNotifications([])
    }
  }

  const handleNotificationNavigate = (notif) => {
    const project = projects.find(p => p.id === notif.project_id)
    if (project) {
      setSelectedProject(project)
      if (notif.task_id) {
        // Find the task and its stage index
        for (let si = 0; si < project.stages?.length; si++) {
          const task = project.stages[si].tasks?.find(t => t.id === notif.task_id)
          if (task) {
            setSelectedTask({ task, stageIndex: si })
            setView('task')
            return
          }
        }
      }
      setView('project')
    }
  }

  // Reload projects function
  const reloadProjects = async () => {
    if (demoMode) {
      const local = loadLocal()
      setProjects(local)
      return
    }

    if (user) {
      const { data, error } = await db.getProjects(user.id)
      if (!error && data) {
        setProjects(data)
      }
    }
  }


  // Listen for invitation-accepted event to reload projects
  useEffect(() => {
    const handleInvitationAccepted = (e) => {
      dlog('🎉 Invitation accepted, reloading projects...', e.detail)
      reloadProjects()
      // Add notification for the shared project
      if (demoMode && e.detail?.projectId) {
        const newNotif = {
          id: uuid(),
          type: 'project_shared',
          title: 'You were added to a project',
          message: `You now have access to a shared project`,
          project_id: e.detail.projectId,
          is_read: false,
          created_at: new Date().toISOString()
        }
        const updated = [newNotif, ...notifications]
        setNotifications(updated)
        localStorage.setItem('hypothesys_notifications', JSON.stringify(updated))
      }
    }

    window.addEventListener('invitation-accepted', handleInvitationAccepted)
    return () => window.removeEventListener('invitation-accepted', handleInvitationAccepted)
  }, [user, demoMode, notifications])

  // Load projects and notifications
  useEffect(() => {
    if (authLoading) return

    const loadData = async () => {
      if (demoMode) {
        const local = loadLocal()
        setProjects(local)
        loadNotifications()
        loadNotificationSettings()
        setLoading(false)
        return
      }

      if (user) {
        // Parallelize projects, notifications, and notification settings loading
        const [projectsResult, _, __] = await Promise.all([
          db.getProjects(user.id),
          loadNotifications(),
          loadNotificationSettings()
        ])

        const { data, error } = projectsResult
        if (!error && data) {
          // Merge local optimistic items (those marked `is_local`) into server response
          try {
            const merged = data.map(serverProj => {
              const localProj = projects.find(p => p.id === serverProj.id)
              if (!localProj) return serverProj
              const mergedStages = (serverProj.stages || []).map(serverStage => {
                const localStage = (localProj.stages || []).find(s => s.id === serverStage.id)
                if (!localStage) return serverStage
                const serverTaskIds = new Set((serverStage.tasks || []).map(t => t.id))
                const localOnlyTasks = (localStage.tasks || []).filter(t => t.is_local && !serverTaskIds.has(t.id))
                // Also merge local-only subtasks under tasks that exist on server
                const mergedTasks = (serverStage.tasks || []).map(serverTask => {
                  const localTask = (localStage.tasks || []).find(t => t.id === serverTask.id)
                  if (!localTask) return serverTask
                  const serverSubtaskIds = new Set((serverTask.subtasks || []).map(st => st.id))
                  const localOnlySubtasks = (localTask.subtasks || []).filter(st => st.is_local && !serverSubtaskIds.has(st.id))
                  return { ...serverTask, subtasks: [...(serverTask.subtasks || []), ...localOnlySubtasks] }
                })
                return { ...serverStage, tasks: [...mergedTasks, ...localOnlyTasks] }
              })
              return { ...serverProj, stages: mergedStages }
            })
            setProjects(merged)
          } catch (e) {
            // Fallback: if merge fails, just set server data
            setProjects(data)
          }
        }
        // Notification loading already handled in Promise.all above
      }
      setLoading(false)
    }

    loadData()
  }, [user, authLoading, demoMode])

  // Real-time sync subscription
  useEffect(() => {
    if (demoMode || !user || projects.length === 0) return

    const projectIds = projects.map(p => p.id)
    let debounceTimer = null

    const handleRealtimeChange = (payload) => {
      dlog('🔄 Realtime change detected:', payload.table, payload.eventType)

      // Quick relevance checks to avoid unnecessary reloads that clobber optimistic UI
      const table = payload.table
      let relevant = false

      if (table === 'projects' || table === 'stages') {
        relevant = true
      } else if (table === 'tasks') {
        const stageId = payload.new?.stage_id || payload.old?.stage_id
        if (stageId) {
          for (const p of projects) {
            if ((p.stages || []).some(s => s.id === stageId)) { relevant = true; break }
          }
        }
      } else if (table === 'subtasks') {
        const taskId = payload.new?.task_id || payload.old?.task_id
        if (taskId) {
          for (const p of projects) {
            if ((p.stages || []).some(s => (s.tasks || []).some(t => t.id === taskId))) { relevant = true; break }
          }
        }
      } else if (table === 'today_items') {
        relevant = payload.new?.user_id === user.id || payload.old?.user_id === user.id
      } else {
        // conservatively treat other tables as relevant
        relevant = true
      }

      if (!relevant) return

      // Debounce to avoid multiple rapid reloads
      // Use longer debounce for local changes to allow optimistic UI to finish
      const delay = payload.new?.modified_by === user.id ? 2000 : 500
      if (debounceTimer) clearTimeout(debounceTimer)
      debounceTimer = setTimeout(async () => {
        dlog('🔄 Reloading projects due to realtime change...')
        const { data, error } = await db.getProjects(user.id)
        if (!error && data) {
          // Filter out recently-deleted projects and tasks to prevent resurrection
          const filtered = data
            .filter(p => !deletedProjectIdsRef.current.has(p.id))
            .map(p => ({
              ...p,
              stages: (p.stages || []).map(s => ({
                ...s,
                tasks: (s.tasks || []).filter(t => !deletedTaskIdsRef.current.has(t.id))
              }))
            }))
          setProjects(filtered)
        }
        // Also reload notifications and today items
        loadNotifications()

        // Reload today items
        const { data: tData } = await db.getTodayItems(user.id)
        if (tData !== null && tData !== undefined) {
          const items = Array.isArray(tData.items) ? tData.items : []
          const updated_at = tData.updated_at || new Date().toISOString()
          const incomingTime = new Date(updated_at).getTime()
          const currentTime = todayUpdatedAtRef.current ? new Date(todayUpdatedAtRef.current).getTime() : -Infinity
          // Only apply if newer than what we already hold
          if (incomingTime >= currentTime) {
            todayUpdatedAtRef.current = updated_at
            setTodayItems(items)
            const key = getTodayKey()
            localStorage.setItem(key, JSON.stringify({ items, updated_at }))
          }
        }
      }, delay)
    }

    const channel = db.subscribeToUserProjects(user.id, projectIds, handleRealtimeChange)

    return () => {
      if (debounceTimer) clearTimeout(debounceTimer)
      if (channel) db.unsubscribe(channel)
    }
  }, [user, demoMode, projects.length > 0]) // Only re-subscribe when user changes or projects go from 0 to non-zero

  const reorderProjects = async (updatedProjects) => {
    if (demoMode) {
      setProjects(updatedProjects)
      saveLocal(updatedProjects)
      // Also save member priorities for demo mode
      const memberPriorities = {}
      updatedProjects.forEach((p, index) => {
        // For shared projects (not owned by current user), store user-specific priority
        if (p.owner_id && p.owner_id !== user?.id) {
          memberPriorities[p.id] = index + 1
        }
      })
      if (Object.keys(memberPriorities).length > 0) {
        localStorage.setItem('hypothesys_member_priorities', JSON.stringify(memberPriorities))
      }
      return
    }
    // In real mode, update priorities differently for owned vs shared projects
    const ownedUpdates = []
    const sharedUpdates = []
    updatedProjects.forEach((project, index) => {
      if (project.owner_id === user?.id) {
        // Owned projects: update project.priority_rank
        ownedUpdates.push(
          db.updateProject(project.id, { priority_rank: index + 1 })
        )
      } else {
        // Shared projects: update project_members.priority_rank for this user
        sharedUpdates.push(
          db.updateMemberPriority(project.id, user?.id, index + 1)
        )
      }
    })
    try {
      await Promise.all([...ownedUpdates, ...sharedUpdates])
      setProjects(updatedProjects)
    } catch (e) {
      derr('❌ Failed to persist priority order:', e)
      // Optionally show error to user
    }
  }

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-brand-600" />
      </div>
    )
  }

  if (!user) {
    return <LoginPage />
  }

  // Handle search navigation
  const handleSearchNavigate = (type, item) => {
    if (type === 'project') {
      setSelectedProject(item.project)
      setView('project')
    } else if (type === 'task') {
      setSelectedProject(item.project)
      setSelectedTask({ task: item.task, stageIndex: item.stageIndex })
      setView('task')
    }
  }

  const ctx = {
    projects, setProjects,
    selectedProject, setSelectedProject,
    selectedTask, setSelectedTask,
    view, setView,
    loading,
    reorderProjects,
    todayItems, addToToday, addLocalTodayTask, removeTodayItem, reorderToday, reorderTasks, reorderSubtasks, moveTaskBetweenStages,
    toggleTodayDone,
    addSubtaskToToday,
    removeTodayItems, duplicateTodayItems,
    reloadProjects,
    // Expose helpers used by child components
    setTodayItems,
    saveTodayItems,
    showToast,
    user,
    demoMode,
    tags, createTag, editTag, deleteTag, assignTag, unassignTag,
    activeTagPicker, setActiveTagPicker,
    duplicateCheck, setDuplicateCheck, handleDuplicateAction,
    // Deletion guards: shared so child delete handlers can mark items
    // as deleted and the realtime listener won't resurrect them.
    deletedProjectIdsRef, deletedTaskIdsRef
  }


  return (
    <AppContext.Provider value={ctx} >
      <div className="min-h-screen pb-8">
        <Header
          projects={projects}
          onSearchNavigate={handleSearchNavigate}
          notifications={notifications}
          onMarkNotificationRead={handleMarkNotificationRead}
          onMarkNotificationUnread={handleMarkNotificationUnread}
          onMarkAllNotificationsRead={handleMarkAllNotificationsRead}
          onDeleteNotification={handleDeleteNotification}
          onDeleteMultipleNotifications={handleDeleteMultipleNotifications}
          onClearAllNotifications={handleClearAllNotifications}
          onNotificationNavigate={handleNotificationNavigate}
          onLogoClick={() => { setView('main'); setSelectedProject(null); setActiveTab('projects') }}
          notificationSettings={notificationSettings}
          onUpdateNotificationSettings={updateNotificationSettings}
        />
        {view === 'main' && (
          <>
            <TabNav tab={activeTab} setTab={setActiveTab} />
            {activeTab === 'projects' ? <ProjectsView /> : activeTab === 'today' ? <TodayView /> : <AllTasksView />}
          </>
        )}
        <Walkthrough
          steps={[
            { title: 'Welcome to HypotheSys™', body: 'Tip: Tap the logo to return to this dashboard anytime.', selector: '#app-logo' },
            { title: 'Projects', body: 'Create and organize projects here.', selector: '#tab-projects' },
            { title: 'Reorder Projects', body: 'Reorder your projects to change priority.', selector: '#projects-reorder-btn' },
            { title: 'Sharing', body: 'Share projects with collaborators and see shared badges.', selector: '#project-card-0-shared-desktop' },
            { title: 'Tasks & Subtasks', body: 'Manage tasks, set reminders, and add subtasks under each task.', selector: '#tab-tasks' },
            { title: 'Tod(o)ay', body: 'Quickly pick today’s priorities or add fast local items.', selector: '#tab-today' }
          ]}
          visible={walkVisible}
          onClose={() => { try { localStorage.setItem('hypothesys_walkthrough_seen_v1', '1') } catch (e) { }; setWalkVisible(false) }}
        />
        {view === 'project' && <ProjectDetail />}
        {view === 'task' && <TaskDetail />}

        {toast && (
          <div className="fixed bottom-20 right-6 z-50">
            <div className="px-4 py-2 bg-gray-900 text-white rounded-lg shadow-lg text-sm">{toast.message}</div>
          </div>
        )}

        <footer className="fixed bottom-0 left-0 right-0 py-2 text-center text-[10px] text-gray-400 bg-white/80 backdrop-blur-sm border-t border-gray-100">
          HypotheSys™ © 2026 <a href="http://tinyurl.com/kennethkusima" target="_blank" rel="noopener noreferrer" className="hover:text-gray-600 underline">Kenneth Kusima</a>. All rights reserved.
        </footer>
      </div>
    </AppContext.Provider >
  )
}

export default function App() {
  return (
    <ErrorBoundary>
      <AppContent />
    </ErrorBoundary>
  )
}
