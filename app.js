// Simple WhatsApp chat viewer with infinite scroll
(function(){
  const fileInput = document.getElementById('fileInput')
  const chatEl = document.getElementById('chat')
  const loadingEl = document.getElementById('loading')

  let messages = [] // parsed messages, newest last
  let renderIndex = 0 // how many messages have been rendered (from end)
  const BATCH = 50
  let chatBase = null // when loading via ?chat= this is the base folder to load media from
  let allMessages = [] // store all messages before filtering
  let fromDate = null // date range filter
  let toDate = null // date range filter
  let searchTerm = '' // keyword filter

  // If a query param `chat` is provided (e.g. ?chat=/chats/example) try to fetch `${chat}/_chat.txt`
  async function loadFromQuery(){
    try{
      const params = new URLSearchParams(window.location.search)
      const chatParam = params.get('chat')
      const reversed = params.get('reversed') === '1'
      if(!chatParam) return
      // normalize and build path
      const base = chatParam.replace(/\/+$/,'')
      chatBase = base
      const candidates = [base + '/_chat.txt', base + '.txt', base]
      loadingEl.textContent = `Loading ${candidates[0]} ...`
      // try sequentially
      let loaded = false
      for(const path of candidates){
        try{
          const res = await fetch(path)
          if(!res.ok) continue
          const text = await res.text()
          allMessages = parseWhatsAppExport(text)
          if(reversed) allMessages.reverse()
          filterAndRender()
          loadingEl.textContent = `Loaded ${path}`
          loaded = true
          break
        }catch(err){
          // try next
          continue
        }
      }
      if(!loaded){
        loadingEl.textContent = `Failed to load any chat at ${base} (tried ${candidates.join(', ')})`
      }
    }catch(e){
      console.error(e)
    }
  }
  loadFromQuery()

  fileInput.addEventListener('change', async (e)=>{
    const params = new URLSearchParams(window.location.search)
    const reversed = params.get('reversed') === '1'
    const f = e.target.files && e.target.files[0]
    if(!f) return
    const text = await f.text()
    allMessages = parseWhatsAppExport(text)
    if (reversed) allMessages.reverse()
    filterAndRender()
  })

  // infinite scroll: load more when scrolled near top (because we render newest at bottom and flex-column-reverse)
  chatEl.addEventListener('scroll', ()=>{
    if(chatEl.scrollTop < 200){
      renderMore()
    }
  })

  function renderMore(){
    if(renderIndex >= messages.length) {
      loadingEl.textContent = 'No more messages'
      return
    }
    const start = renderIndex
    const end = Math.min(messages.length, renderIndex + BATCH)
    const slice = messages.slice(start, end)
    // since chat uses column-reverse, append newer batches at the end of container in order
    slice.forEach(msg => chatEl.appendChild(messageNode(msg)))
    renderIndex = end
    loadingEl.textContent = 'Scroll to load more...'
  }

  function messageNode(m){
    // container
    const wrapper = document.createElement('div')
    // day separator
    if(m.showDate){
      const d = document.createElement('div')
      d.className = 'day-sep'
      d.textContent = m.dateLabel
      wrapper.appendChild(d)
    }

    const msg = document.createElement('div')
    msg.className = 'message ' + (m.isMe? 'mine':'their') + (m.deleted? ' deleted':'')

    const meta = document.createElement('div')
    meta.className = 'meta'
    meta.textContent = `${m.sender} • ${m.timeLabel}`

  const content = document.createElement('div')
  content.className = 'content'
  // render text and attachments
  const nodes = createContentNodes(m.text)
  nodes.forEach(n => content.appendChild(n))

    msg.appendChild(meta)
    msg.appendChild(content)
    wrapper.appendChild(msg)
    return wrapper
  }

  // Basic parser for WhatsApp exported text files (common formats)
  // It tries to detect lines that start a new message using timestamp at start like: [17/08/2022, 6:28:17 PM]
  function parseWhatsAppExport(text){
    const lines = text.split(/\r?\n/)
    const msgs = []

    // RegExp matches common patterns: [dd/mm/yyyy, hh:mm:ss AM/PM] or [dd/mm/yyyy, hh:mm AM/PM] or 22/08/2022, 13:14:49
    const startRe = /^\[?(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}),?\s+(\d{1,2}:\d{2}(?::\d{2})?(?:\s?[APMapm]{2})?)\]?\s*(?:[-–:]\s*)?(.*)$/

    let cur = null
    for(const raw of lines){
      // sanitize invisible / directional characters which can break regex matching
      // remove: LEFT-TO-RIGHT MARK (U+200E), RIGHT-TO-LEFT MARK (U+200F), NARROW NO-BREAK SPACE (U+202F), BOM/ZWNBSP (U+FEFF), ZERO WIDTH SPACE (U+200B)
      const clean = raw.replace(/[\u200E\u200F\u202F\uFEFF\u200B]/g, '')
      const line = clean.trimEnd()
      if(!line) continue
      const m = line.match(startRe)
      if(m){
        // push previous
        if(cur) msgs.push(cur)
        const dateStr = m[1]
        const timeStr = m[2]
        let rest = m[3] || ''

        // rest may be like 'Sender: message' or 'Sender ❤️: message' or 'P: message'
        const sep = rest.indexOf(':')
        let sender = ''
        let textPart = ''
        if(sep > -1){
          sender = rest.slice(0, sep).trim()
          textPart = rest.slice(sep+1).trim()
        } else {
          // system message (like "Messages to this chat and calls are now secured with end-to-end encryption.")
          sender = ''
          textPart = rest.trim()
        }

        cur = {
          rawDate: dateStr,
          rawTime: timeStr,
          sender: sender || 'System',
          text: textPart || '',
          deleted: textPart.toLowerCase().includes('this message was deleted') || textPart.toLowerCase().includes('you deleted this message') || false,
          isMe: false,
        }
        // heuristics: if sender looks like 'You' or 'Me' or matches phone number? leave as-is.
        if(cur.sender.toLowerCase() === 'you' || cur.sender.toLowerCase() === 'me' || cur.sender === 'P') cur.isMe = true
      } else {
        // continuation of previous message
        if(cur) {
          // append newline then the continued line
          cur.text += '\n' + line
        } else {
          // stray line at top, start a system message
          cur = {rawDate:'', rawTime:'', sender:'System', text: line, deleted:false, isMe:false}
        }
      }
    }
    if(cur) msgs.push(cur)

    // postprocess: convert date/time labels, compute date grouping
    const out = []
    let lastDate = null
    for(const m of msgs){
      const d = parseDateLabel(m.rawDate, m.rawTime)
      const dateOnly = d? d.toDateString(): m.rawDate || ''
      const showDate = dateOnly !== lastDate
      lastDate = dateOnly
      out.push({
        sender: m.sender,
        text: m.deleted? 'This message was deleted' : m.text,
        deleted: m.deleted,
        isMe: m.isMe,
        date: d,
        dateLabel: d? d.toLocaleDateString(): m.rawDate,
        timeLabel: d? d.toLocaleTimeString(): m.rawTime,
        showDate,
      })
    }

    // reverse so that oldest first (we render newest at bottom)
    return out
  }

  function parseDateLabel(datePart, timePart){
    if(!datePart && !timePart) return null
    // Normalize separators
    const dp = datePart.replace(/\-/g,'/')
    // try dd/mm/yyyy or m/d/yy
    const parts = dp.split('/')
    let year, month, day
    if(parts.length===3){
      day = parseInt(parts[0],10)
      month = parseInt(parts[1],10)
      year = parseInt(parts[2],10)
      if(year < 100) year += 2000
      // JS Date: monthIndex 0-based
      const dateStr = `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}T${to24(timePart)||'00:00:00'}`
      const d = new Date(dateStr)
      if(!isNaN(d)) return d
    }
    return null
  }

  function to24(t){
    if(!t) return null
    // remove weird unicode spaces
    t = t.replace(/\u202f/g,' ').trim()
    // handle formats like 6:28:17 PM or 13:14:49
    const m = t.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([APMapm]{2})?/) || []
    if(!m.length) return null
    let hh = parseInt(m[1],10)
    const mm = m[2]
    const ss = m[3] || '00'
    const ampm = (m[4]||'').toUpperCase()
    if(ampm){
      if(ampm === 'PM' && hh<12) hh += 12
      if(ampm === 'AM' && hh===12) hh = 0
    }
    return `${String(hh).padStart(2,'0')}:${mm}:${ss}`
  }

  // Create DOM nodes for a message text that may contain attachment placeholders like <attached: filename>
  function createContentNodes(text){
    const nodes = []
    if(!text) return nodes
    // regex to find ‎<attached: filename> (may contain non-ascii whitespace)
    const attRe = /<?\s*<?attached:\s*([^>\n\r]+)>?/ig
    let lastIndex = 0
    let m
    while((m = attRe.exec(text)) !== null){
      const idx = m.index
      if(idx > lastIndex){
        const txt = text.slice(lastIndex, idx)
        nodes.push(document.createTextNode(txt))
      }
  const filename = m[1].trim().replace(/[\u200E\u200F\u202F\uFEFF\u200B]/g,'')
      const mediaNode = createMediaNode(filename)
      nodes.push(mediaNode)
      lastIndex = attRe.lastIndex
    }
    if(lastIndex < text.length){
      nodes.push(document.createTextNode(text.slice(lastIndex)))
    }
    // If there were no attachments and only text, return a single text node
    if(nodes.length===0) nodes.push(document.createTextNode(text))
    return nodes
  }

  function createMediaNode(filename){
    const wrap = document.createElement('div')
    wrap.className = 'attachment'
    // if we have a chatBase, resolve relative path
    const src = chatBase ? (chatBase.replace(/\/$/,'') + '/' + filename) : filename
    const lower = filename.toLowerCase()
    if(lower.match(/\.(jpg|jpeg|png|gif|webp)$/)){
      const img = document.createElement('img')
      img.src = src
      img.alt = filename
      img.className = 'attached-image'
      wrap.appendChild(img)
    } else if(lower.match(/\.(mp3|wav|ogg|opus)$/)){
      const a = document.createElement('audio')
      a.controls = true
      const s = document.createElement('source')
      s.src = src
      a.appendChild(s)
      wrap.appendChild(a)
    } else if(lower.match(/\.(pdf)$/)){
      const a = document.createElement('a')
      a.href = src
      a.target = '_blank'
      a.textContent = filename + ' (pdf)'
      wrap.appendChild(a)
    } else {
      // fallback: link to file
      const a = document.createElement('a')
      a.href = src
      a.target = '_blank'
      a.textContent = filename
      wrap.appendChild(a)
    }
    return wrap
  }

  // Filter messages by date range and keywords, then re-render
  function filterAndRender() {
    messages = allMessages.filter(msg => {
      // Date filter
      if (msg.date) {
        if (fromDate && msg.date < fromDate) return false
        if (toDate && msg.date > toDate) return false
      }
      
      // Keyword filter
      if (searchTerm) {
        const searchText = searchTerm.toLowerCase()
        const content = [
          msg.text,
          msg.sender,
          msg.dateLabel,
          msg.timeLabel
        ].join(' ').toLowerCase()
        
        // Split search terms by spaces and check if all terms match
        const terms = searchText.split(/\s+/).filter(t => t)
        if (terms.length && !terms.every(term => content.includes(term))) {
          return false
        }
      }
      
      return true
    })
    renderIndex = 0
    chatEl.innerHTML = ''
    renderMore()
    
    // Update status with filter info
    const total = allMessages.length
    const filtered = messages.length
    if (filtered === total) {
      loadingEl.textContent = 'Scroll to load more...'
    } else {
      loadingEl.textContent = `Showing ${filtered} of ${total} messages`
    }
  }

  // Date filter handlers
  const fromDateInput = document.getElementById('fromDate')
  const toDateInput = document.getElementById('toDate')
  const clearFilterBtn = document.getElementById('clearFilter')

  fromDateInput.addEventListener('change', (e) => {
    const val = e.target.value
    fromDate = val ? new Date(val) : null
    if (fromDate) fromDate.setHours(0,0,0,0)
    filterAndRender()
  })

  toDateInput.addEventListener('change', (e) => {
    const val = e.target.value
    toDate = val ? new Date(val) : null
    if (toDate) toDate.setHours(23,59,59,999)
    filterAndRender()
  })

  clearFilterBtn.addEventListener('click', () => {
    fromDate = null
    toDate = null
    searchTerm = ''
    fromDateInput.value = ''
    toDateInput.value = ''
    searchInput.value = ''
    filterAndRender()
  })
  
  // Keyword search handler
  const searchInput = document.getElementById('searchInput')
  let searchTimeout = null
  searchInput.addEventListener('input', (e) => {
    // Debounce search to avoid too many re-renders while typing
    if (searchTimeout) clearTimeout(searchTimeout)
    searchTimeout = setTimeout(() => {
      searchTerm = e.target.value.trim()
      filterAndRender()
    }, 300)
  })

  // Set min/max dates on inputs when messages load
  function updateDateInputLimits() {
    const dates = allMessages.filter(m => m.date).map(m => m.date)
    if (dates.length) {
      const min = new Date(Math.min.apply(null, dates))
      const max = new Date(Math.max.apply(null, dates))
      fromDateInput.min = min.toISOString().split('T')[0]
      fromDateInput.max = max.toISOString().split('T')[0]
      toDateInput.min = min.toISOString().split('T')[0]
      toDateInput.max = max.toISOString().split('T')[0]
    }
  }

  // Expose parse for testing in console
  window.parseWhatsAppExport = parseWhatsAppExport
})();
