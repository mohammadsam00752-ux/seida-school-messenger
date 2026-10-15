import { useEffect, useRef, useState } from 'react'
import { supabase, isConfigured } from './supabase'
import { Send, LogOut, MessageCircle, ShieldCheck, BookOpen, Users, Plus, RefreshCw } from 'lucide-react'

const school = 'دبیرستان سیدالشهدا کبودرآهنگ'

export default function App() {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [rooms, setRooms] = useState([])
  const [activeRoom, setActiveRoom] = useState(null)
  const [messages, setMessages] = useState([])
  const [draft, setDraft] = useState('')
  const [authMode, setAuthMode] = useState('login')
  const [form, setForm] = useState({ email: '', password: '', fullName: '', grade: 'دهم', major: 'تجربی' })
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const bottomRef = useRef(null)

  useEffect(() => {
    if (!isConfigured) return
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => setSession(nextSession))
    return () => listener.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (session?.user) loadProfileAndRooms()
    else { setProfile(null); setRooms([]); setActiveRoom(null); setMessages([]) }
  }, [session])

  async function loadProfileAndRooms() {
    const { data: p, error: pe } = await supabase.from('profiles').select('*').eq('id', session.user.id).maybeSingle()
    if (pe) { setNotice('خطا در خواندن حساب: ' + pe.message); return }
    setProfile(p)
    if (!p || p.status !== 'approved') { setRooms([]); setNotice('حساب شما هنوز توسط مدیر مدرسه تأیید نشده است.'); return }
    setNotice('')
    const { data: r, error } = await supabase.from('rooms').select('id,name,description').order('name')
    if (error) { setNotice('خطا در دریافت گروه‌ها: ' + error.message); return }
    setRooms(r || [])
    if (r?.length) setActiveRoom(current => current && r.some(x => x.id === current.id) ? current : r[0])
  }

  useEffect(() => {
    if (!session?.user || !activeRoom || profile?.status !== 'approved') return
    let channel
    let cancelled = false
    async function loadMessages() {
      const { data, error } = await supabase.from('messages')
        .select('id,room_id,user_id,body,created_at,profiles(full_name)')
        .eq('room_id', activeRoom.id).order('created_at', { ascending: true }).limit(100)
      if (cancelled) return
      if (error) setNotice('خطا در دریافت پیام‌ها: ' + error.message)
      else setMessages(data || [])
    }
    loadMessages()
    channel = supabase.channel('room-' + activeRoom.id)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: 'room_id=eq.' + activeRoom.id }, payload => {
        const row = payload.new
        supabase.from('profiles').select('full_name').eq('id', row.user_id).maybeSingle().then(({ data }) => {
          setMessages(old => old.some(m => m.id === row.id) ? old : [...old, { ...row, profiles: data }])
        })
      }).subscribe()
    return () => { cancelled = true; if (channel) supabase.removeChannel(channel) }
  }, [session, activeRoom, profile])

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  async function submitAuth(e) {
    e.preventDefault(); setBusy(true); setNotice('')
    try {
      if (authMode === 'signup') {
        const { data, error } = await supabase.auth.signUp({
          email: form.email.trim(), password: form.password,
          options: { data: { full_name: form.fullName.trim(), grade: form.grade, major: form.major } }
        })
        if (error) throw error
        if (data.session) setNotice('ثبت‌نام انجام شد؛ حساب شما پس از تأیید مدیر فعال می‌شود.')
        else setNotice('ثبت‌نام ارسال شد. اگر تأیید ایمیل فعال است، ایمیلت را بررسی کن؛ سپس منتظر تأیید مدیر بمان.')
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email: form.email.trim(), password: form.password })
        if (error) throw error
      }
    } catch (err) { setNotice(err.message || 'خطایی رخ داد.') }
    finally { setBusy(false) }
  }

  async function sendMessage(e) {
    e.preventDefault()
    const body = draft.trim()
    if (!body || !activeRoom || !session?.user) return
    setDraft('')
    const { error } = await supabase.from('messages').insert({ room_id: activeRoom.id, user_id: session.user.id, body })
    if (error) { setDraft(body); setNotice('ارسال پیام ناموفق بود: ' + error.message) }
  }

  async function signOut() { await supabase.auth.signOut() }

  if (!isConfigured) return <SetupScreen />
  if (!session) return <main className="auth-page">
    <div className="auth-card">
      <div className="brand-mark"><MessageCircle size={30} /></div>
      <div className="eyebrow">پیام‌رسان اختصاصی مدرسه</div>
      <h1>سیدا</h1><p className="muted">{school}</p>
      <div className="switcher">
        <button className={authMode === 'login' ? 'selected' : ''} onClick={() => setAuthMode('login')}>ورود</button>
        <button className={authMode === 'signup' ? 'selected' : ''} onClick={() => setAuthMode('signup')}>ثبت‌نام</button>
      </div>
      <form onSubmit={submitAuth} className="auth-form">
        {authMode === 'signup' && <>
          <label>نام و نام خانوادگی<input required value={form.fullName} onChange={e => setForm({...form, fullName:e.target.value})} placeholder="نام کامل" /></label>
          <div className="two-fields">
            <label>پایه<select value={form.grade} onChange={e => setForm({...form, grade:e.target.value})}><option>دهم</option><option>یازدهم</option><option>دوازدهم</option><option>دبیر</option></select></label>
            <label>رشته<select value={form.major} onChange={e => setForm({...form, major:e.target.value})}><option>تجربی</option><option>انسانی</option><option>ریاضی</option><option>عمومی</option></select></label>
          </div>
        </>}
        <label>ایمیل<input type="email" required value={form.email} onChange={e => setForm({...form, email:e.target.value})} placeholder="name@example.com" autoComplete="email" /></label>
        <label>رمز عبور<input type="password" required minLength="8" value={form.password} onChange={e => setForm({...form, password:e.target.value})} placeholder="حداقل ۸ نویسه" autoComplete={authMode === 'login' ? 'current-password' : 'new-password'} /></label>
        <button className="primary-btn" disabled={busy}>{busy ? 'لطفاً صبر کن…' : authMode === 'login' ? 'ورود به سیدا' : 'ساخت حساب'}</button>
      </form>
      {notice && <p className="notice">{notice}</p>}
      <p className="tiny"><ShieldCheck size={14}/> دسترسی به گروه‌ها فقط پس از تأیید مدیر مدرسه امکان‌پذیر است.</p>
    </div>
  </main>

  return <div className="app-shell">
    <header className="topbar">
      <div className="brand-inline"><div className="mini-mark"><MessageCircle size={20}/></div><div><strong>سیدا</strong><small>{school}</small></div></div>
      <div className="user-actions"><span className="user-name">{profile?.full_name || session.user.email}</span><button className="icon-btn" onClick={signOut} title="خروج"><LogOut size={18}/></button></div>
    </header>
    {profile?.status !== 'approved' ? <section className="pending-card"><ShieldCheck size={36}/><h2>در انتظار تأیید مدیر</h2><p>حساب شما ثبت شده، اما تا زمانی که مدیر مدرسه آن را تأیید نکند، گروه‌ها و پیام‌ها در دسترس نیستند.</p><button className="secondary-btn" onClick={loadProfileAndRooms}><RefreshCw size={16}/> بررسی دوباره</button></section> :
      <div className="workspace">
        <aside className="sidebar">
          <div className="side-title"><Users size={18}/> گروه‌های مدرسه</div>
          {rooms.length ? rooms.map(room => <button key={room.id} className={'room-item ' + (activeRoom?.id === room.id ? 'active' : '')} onClick={() => setActiveRoom(room)}>
            <div className="room-avatar"><BookOpen size={18}/></div><div className="room-copy"><strong>{room.name}</strong><small>{room.description || 'گروه مدرسه'}</small></div>
          </button>) : <p className="empty-note">هنوز گروهی ساخته نشده است. مدیر باید گروه‌ها را در پایگاه داده ایجاد کند.</p>}
          <div className="sidebar-foot">فضای امن آموزشی <ShieldCheck size={14}/></div>
        </aside>
        <main className="chat-panel">
          {activeRoom ? <>
            <div className="chat-heading"><div className="room-avatar large"><Users size={20}/></div><div><h2>{activeRoom.name}</h2><p>{activeRoom.description || 'گفت‌وگوی اعضای مدرسه'}</p></div></div>
            <div className="messages-area">
              {messages.length === 0 && <div className="empty-chat"><MessageCircle size={36}/><strong>شروع گفت‌وگو</strong><span>اولین پیام این گروه را بنویس.</span></div>}
              {messages.map(m => <div className={'message-row ' + (m.user_id === session.user.id ? 'mine' : '')} key={m.id}>
                <div className="message-bubble"><div className="sender">{m.user_id === session.user.id ? 'شما' : m.profiles?.full_name || 'عضو مدرسه'}</div><div>{m.body}</div><time>{new Date(m.created_at).toLocaleTimeString('fa-IR', { hour:'2-digit', minute:'2-digit' })}</time></div>
              </div>)}
              <div ref={bottomRef}/>
            </div>
            <form className="composer" onSubmit={sendMessage}><input value={draft} onChange={e => setDraft(e.target.value)} placeholder="پیامت را بنویس…" aria-label="متن پیام"/><button className="send-btn" disabled={!draft.trim()} aria-label="ارسال پیام"><Send size={19}/></button></form>
          </> : <div className="empty-chat"><MessageCircle size={36}/><strong>یک گروه انتخاب کن</strong></div>}
          {notice && <div className="inline-notice">{notice}</div>}
        </main>
      </div>}
  </div>
}

function SetupScreen() {
  return <main className="auth-page"><div className="auth-card setup-card">
    <div className="brand-mark"><MessageCircle size={30}/></div><div className="eyebrow">راه‌اندازی اولیه</div><h1>سیدا</h1>
    <p className="muted">برای فعال‌شدن ورود و چت آنلاین، اتصال پایگاه داده را تنظیم کن.</p>
    <ol className="setup-steps">
      <li>در <a href="https://supabase.com" target="_blank" rel="noreferrer">Supabase</a> یک پروژه بساز.</li>
      <li>فایل <code>supabase/schema.sql</code> را در بخش SQL Editor اجرا کن.</li>
      <li>فایل <code>.env.example</code> را به <code>.env</code> تغییر نام بده و URL و کلید عمومی پروژه را وارد کن.</li>
      <li>در ترمینال اجرا کن: <code>npm install</code> سپس <code>npm run dev</code>.</li>
    </ol>
    <p className="notice">کلید <strong>service_role</strong> را هرگز داخل برنامه یا فایل <code>.env</code> سمت مرورگر قرار نده.</p>
  </div></main>
}