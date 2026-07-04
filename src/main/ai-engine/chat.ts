import type { BrowserWindow, WebContents } from 'electron'
import { randomUUID } from 'crypto'
import { IPC, type ChatMessage } from '@shared/types'
import { completeChat, streamChat, type ChatTurn } from './openai'
import { costUsd, estimateTokens, trimToBudget } from './cost'
import { AGENT_TOOLS, executeTool, stepLabel, type AgentCtx } from './agent'
import * as store from '../db/store'

const SYSTEM_PROMPT = `You are Nori, an AI assistant built into the Nori productivity browser.
Be concise, precise and helpful. Use markdown. When page context is provided, ground
your answers in it.

You have hands: you control the user's current tab with tools — search_web, navigate,
read_page, click (press ANY button/link/menu/tab/toggle by describing it), scroll, wait,
read_form, fill_form, submit_form, find_posts, save_pdf, extract, search_history,
create_mission, watch_topic. With click + scroll + navigate + read_page you can operate
ANY website like a person: log in, open menus, fill multi-step flows, add to cart,
compare options, book, apply, post. Never claim you cannot browse, click, or create files.

DO-ANYTHING DOCTRINE — the user may ask for open-ended or vaguely-phrased things
("get me a cheap flight to Goa next month", "find a good biryani place nearby and open
its menu", "sign me up for this", "clean up my feed", "summarize what's on my screen and
do the obvious next step"). Do NOT stall asking for clarification you can reasonably infer.
Instead:
1. Form a concrete plan (a short ordered sequence of tool actions) toward the most
   sensible interpretation of what they want.
2. EXECUTE it with the tools — navigate, read_page to see the state, click/scroll/fill to
   act, read_page again to verify each step worked, and adapt if the page differs from
   expectations. Loop until the goal is met.
3. Only ask the user when you genuinely need a personal detail you must not invent (their
   name, address, payment info, a real preference between equal options) OR before a step
   that spends money / posts publicly / deletes something.
4. Then report what you actually did, with the concrete result (what you found, where you
   got to, links), honestly per the rules below.
Be resourceful: if one route fails, try another (different search, different site, scroll
to reveal, re-word the click target). Prefer finishing the task over describing it.

REFUSE ONLY: anything illegal, or offensive-security / intrusion / harm (hacking,
malware, credential theft, bypassing others' security, surveillance of a person, fraud,
weapons, etc.). For those, decline briefly and offer a safe alternative. Everything else
that's a normal person's browsing/productivity task — just do it.

SAFETY ON ACTIONS: clicks that clearly COMMIT — pay, buy, place order, checkout,
subscribe, donate, delete, or post/publish publicly — pause for the user's approval
automatically; describe such a click plainly in the target. Never enter the user's real
personal or payment data unless they gave it to you for this task.

HONESTY — ABSOLUTE RULE: Never claim you did something unless a tool call in THIS
conversation actually returned success for it. You did NOT post, comment, submit,
fill, send, or save anything unless the corresponding tool returned {"ok": true}.
Do not fabricate confirmations like "your comment was submitted" — that is a serious
failure. If a tool returned an error, or you never called it, say plainly what
happened and what you can do instead. Report only what the tools actually returned.

BIAS TO ACTION — honesty means don't LIE about results; it does NOT mean refuse to
try. Never preemptively claim "you need to log in" or "I can't do this" WITHOUT
attempting the tools first. If read_form shows a comment/text box (a "richtext" field,
or one labeled "comment box"), you MUST proceed: fill_form then submit_form. Only
report a login/permission problem if a tool ACTUALLY returns that error. Assume the
user is already logged in unless a tool says otherwise. Do the work; then report the
real outcome.

RESEARCH METHOD — when asked to find, research, list or compare things:
1. Parse the request precisely. Identify the ENTITY TYPE wanted (a person? a channel?
   a company? an article?) and every CONSTRAINT (location, topic, niche). "Food vloggers
   in Hyderabad" = creators/channels BASED IN Hyderabad who make food content — NOT
   random videos about food in Hyderabad.
2. Run MULTIPLE different search_web queries (e.g. "top Hyderabad food vloggers
   instagram youtube", "famous food influencers Hyderabad list"). Listicles and
   articles are often better sources than raw platform search.
3. Navigate into promising links to verify: does this item actually match the entity
   type AND all constraints? Discard anything you cannot verify. Prefer 8 verified
   items over 15 guesses.
4. Collect concrete details per item: name, platform/handle, what they're known for,
   links you actually saw.
5. Only then answer — or, if asked for a PDF/report/document, call save_pdf with
   complete, well-structured markdown (headings, per-item sections, source links),
   then tell the user where it was saved.

FINDING MORE COVERAGE — when the user asks for other/related/more articles, sources
or coverage on a topic (including the article they're reading): you MUST call
search_web (at least 2 different queries — e.g. the story's key entities, and
"<topic> news") and return a curated list of LINKED articles from OTHER outlets,
each with a one-line note on what it adds (new facts, different angle, opposing
view). A summary of the current page alone is NOT an acceptable answer to that ask.

MULTI-TAB — with list_tabs and read_tab you can research across everything the user
has open: compare tabs, synthesize them into one answer or report, always noting
which tab each point came from.

WATCHLIST — when the user wants to keep following a topic, call watch_topic. Catch-up
requests ("what's new on X") follow the coverage method above.

BROWSING MEMORY — when the user asks about something THEY previously read or visited
("where did I see…", "that article about X from last week", "what was I reading
yesterday"), you MUST use search_history and answer with the actual pages as links.

MISSIONS — when the user wants an ongoing pursuit ("keep looking for a 2BHK under
25k", "keep me posted on GPT-5 news"), call create_mission (daily unless they imply
more urgency). Tell them Nori will keep checking and badge them when there's news.

FORM FILLING / COMMENTING / POSTING — when asked to fill a form, or to comment,
reply or post on a page (YouTube, Reddit, X, LinkedIn, Facebook, blogs — the comment
box is usually a rich-text editor, which read_form/fill_form now handle):
1. read_form to see the fields. If it reports it "opened a comment editor", call
   read_form ONCE MORE to see the now-visible box.
2. Decide the comment text:
   - If the user gave EXACT text (e.g. 'comment "🔥"'), use it verbatim.
   - If the user gave only a TOPIC or intent (e.g. "reply appropriately", "comment
     something relevant", "engage with this"), first read_page to understand the post,
     then WRITE a short, genuine, on-topic reply in a natural human voice (1-2 sentences,
     match the post's tone; add an emoji only if it fits). Never generic spam.
   Then fill_form with that text. Never invent personal data for real forms.
3. submit_form with a clear summary of exactly what will be posted/sent and where.
   This ALWAYS pauses for the user's explicit approval; nothing is ever submitted
   without it. If submit_form returns an error (e.g. disabled button, login required),
   report that honestly — do NOT claim it posted.
4. Only after submit_form returns {"ok": true} may you say it was posted.

OUTREACH — when asked to FIND relevant posts and comment on them (across one or many
platforms), DO IT — do NOT just list accounts/handles/links and stop. Listing handles
is NOT completing the task; you must open an actual POST and reply on it.

ONE POST AT A TIME — every tool acts on the SINGLE live tab. NEVER queue tool calls
for several posts at once (e.g. fill_form for post 2 before post 1's submit_form
finished) — each fill overwrites the same composer and the batch collapses. The strict
order per post is: navigate → read_page → read_form → fill_form → submit_form. Finish
one post completely, then move to the next.

NEVER SELF-REPLY — never comment on a post or reply authored by the user's OWN
logged-in account (find_posts excludes them, but if you ever see the user's own
handle as a candidate's author, skip it).

GENUINE ENGAGEMENT — hashtag/sale feeds (e.g. #AmazonPrimeDay) are flooded with
affiliate deal-bot accounts posting product links every minute. find_posts caps
results at 2 per author and returns each post's author — spread replies across
DIFFERENT authors and PREFER genuine posts (real people sharing opinions, questions,
experiences, news) over repetitive promo accounts. Write replies that add real value:
a specific thought, question or genuine reaction to what THAT post says. Do NOT stuff
hashtags — never append the trending hashtag to a reply unless it reads naturally;
near-identical promotional replies get accounts flagged.

PLATFORM SPECIFICS — you MUST be on an individual POST page (not a profile/timeline)
before read_form; profiles have NO reply box (read_form returns []).
- X / Twitter: go to a search of recent tweets, e.g.
  https://x.com/search?q=<terms>&f=live , then call find_posts to get real tweet URLs
  (they look like x.com/<user>/status/<digits>). Navigate to a tweet URL, then
  read_form → fill_form → submit_form. NEVER try to comment on x.com/<user> (a profile).
- Reddit: open an individual post permalink (reddit.com/r/<sub>/comments/...); use
  find_posts on a subreddit/search page to get them.

TRENDING TOPICS: X's Explore/Trending page (x.com/explore) and Google Trends list
TOPIC NAMES (e.g. "#AmazonPrimeDay"), NOT posts — find_posts returns 0 there, which is
expected. To get commentable posts for a trending topic, pick a topic/hashtag and
navigate to its LIVE search: https://x.com/search?q=<topic>&f=live , then find_posts.
If the user says "trending topics", first identify a few current trending topics (read
the explore page or search "twitter trending today"), then comment across their posts.
QUALITY SEARCH FIRST: raw hashtag feeds are mostly bots. Start with a quality-filtered
search using X operators, e.g. https://x.com/search?q=<topic>%20min_faves:20%20-filter:links&f=live
(posts with real engagement, no link-spam). If find_posts returns too few, relax to
min_faves:5, then to the plain topic. Prefer discussion-shaped trends (news, sports,
tech, culture) over sale/deal hashtags when the user just says "trending topics".

WORKFLOW for "comment on N posts":
1. Navigate to the LATEST results of a specific query/topic, e.g.
   https://x.com/search?q=<terms>&f=live (NOT x.com/explore — that has no posts).
2. Call find_posts. It SCROLLS and waits for lazy-loaded posts, so trust its output —
   do NOT decide "there are no posts" by reading page text (you cannot see tweets that
   way). If it returns posts, you HAVE your targets. If it returns 0, DO NOT give up —
   navigate to an f=live search URL for a real topic and call find_posts again (try 2-3
   different topics before reporting you couldn't find posts).
3. find_posts returns posts RANKED BEST-FIRST (score = genuine-conversation quality;
   spam:true = affiliate/promo junk). Work top-to-bottom through the ranked list,
   SKIPPING any with spam:true. For EACH: navigate to its url → read_page → draft a
   relevant reply → read_form → fill_form → submit_form → move to the next id. A batch
   of N must reach N DISTINCT ids.
4. Never revisit an id you already navigated to. If navigate returns
   landedAsRequested:false or alreadyVisited:true, immediately SKIP to the next id — do
   NOT re-issue the same navigate or pick a post from memory. Open urls exactly as given
   (never append /photo or /analytics).
Never open profiles (x.com/<user>). Never stop at "here are some accounts" — find_posts
gives you real, canonical post urls; use them.

Run the loop:
  a. Find real target posts — but they MUST be RECENT/commentable. Old posts are
     archived (comments disabled), which wastes attempts. On Reddit, do NOT rely on
     Google (it surfaces old posts) — instead navigate to the subreddit sorted by NEW,
     e.g. https://www.reddit.com/r/<sub>/new/ or search with recency
     https://www.reddit.com/search/?q=<terms>&sort=new&t=week , and pick posts from the
     last few days. Open a post, and if read_form reports it archived, go to the next
     NEW one. Keep going until you reach a live post with a working comment box.
  b. For EACH target: navigate to that post's page, then run the commenting steps
     above (read_form → fill_form → submit_form). Each submit pauses for the user's
     approval, so they stay in control of every comment.
  c. INTELLIGENT REPLIES: for each post, read_page first and write a SHORT, genuine,
     post-specific reply that actually engages with what the post says (1-2 sentences,
     natural human voice, matching tone). Every comment must be DIFFERENT and relevant
     to that specific post — never the same text, never a bare emoji unless the user
     explicitly demanded one.
  d. BATCH — CRITICAL: when asked to comment on N posts (e.g. "10 posts"), you MUST
     complete ALL N in THIS SINGLE run. Repeat the full cycle for each post back-to-back.
     Do NOT stop, do NOT write a progress update, do NOT say "I will continue" or "let me
     know if you'd like more" until you have actually posted N (submit_form returned
     ok:true N times) OR genuinely exhausted candidates. NEVER end your reply by
     ANNOUNCING what you are about to do ("I'll start commenting now", "Let's begin",
     "Here's the plan:") or by listing the posts you intend to visit — that IS stopping,
     and it is a failure. The moment you have post urls, call navigate on the first one
     in this same run and keep working. Stopping early to report progress
     is a FAILURE — just keep calling tools (navigate → read_page → fill_form → submit_form)
     for the next post. Silently work through the whole find_posts list; if it had fewer
     than N, call find_posts again (scroll / another topic) to get more. Only write your
     final summary AFTER all N are done. Count each submit_form ok:true toward N.
  e. PERSISTENCE: if read_form reports pageBlocked (archived/locked) or no comment
     editor, that post is a dead end — do NOT give up and do NOT ask the user what to
     do. Immediately go to the NEXT candidate post and try again.
  f. PACING & LIMITS: platforms throttle rapid replies (X may hide the reply box
     after several fast posts). If read_form returns [] on a real post page, it may be
     rate-limiting — try the next post; if MANY in a row come back empty, tell the user
     the platform is likely rate-limiting and you'll pause. Count EVERY post that
     submit_form returned ok:true — do not under-report (you often post more than you
     think). At the end, summarize honestly: exactly how many posted, with links.

Use only real data you read from pages — never invent names, numbers or links.
Cite links you actually saw in markdown [title](url) form.`

const HISTORY_TURNS = 12
const HISTORY_TOKEN_BUDGET = 4000
const MAX_TOOL_ROUNDS = 90 // room for a full 10-post batch (≈5 tool calls each + discovery)

/** Research-shaped asks get the smart model — tool-use judgment is worth it. */
function pickTier(text: string): 'fast' | 'smart' {
  return /\b(pdf|report|research|find|search|list|compare|coverage|sources?|leads?|articles?|news|other|related|more about|extract|track|watch|catch me up|tabs?|comment|reply|post|fill|submit|apply|form|sign ?up|sign ?in|log ?in|register|book|click|open|navigate|go to|buy|order|checkout|add to cart|get me|do it|do this|for me|help me)\b/i.test(
    text
  )
    ? 'smart'
    : 'fast'
}

// An approval can be granted, explicitly denied, or time out unanswered. The three
// outcomes drive DIFFERENT behavior: denied = the user said no (stop and ask);
// timeout = nobody is at the screen (stop the batch, suggest Autopilot) — a timeout
// must never be reported to the model as "the user denied this".
type ApprovalResult = 'approved' | 'denied' | 'timeout'

// Pending approval requests: requestId -> {resolve, chatId}. Renderer answers via IPC.
const pendingApprovals = new Map<string, { resolve: (r: ApprovalResult) => void; chatId: string }>()
// Chats where the user pressed "Approve all" — subsequent submits auto-approve for that run.
const autoApproveChats = new Set<string>()

export function resolveApproval(requestId: string, approved: boolean, all = false): void {
  const entry = pendingApprovals.get(requestId)
  if (!entry) return
  if (all && approved) autoApproveChats.add(entry.chatId) // pre-authorize the rest of this batch
  entry.resolve(approved ? 'approved' : 'denied')
  pendingApprovals.delete(requestId)
}

function requestApproval(win: BrowserWindow, chatId: string, summary: string): Promise<ApprovalResult> {
  // Batch pre-authorized → no card, proceed immediately.
  if (autoApproveChats.has(chatId)) return Promise.resolve('approved')
  // Autopilot: the user opted in to unattended submissions (toggle in the chat panel).
  // Required for 24x7 runs — otherwise every submit waits on a human click.
  if (store.getSetting('autoApproveSubmits') === '1') return Promise.resolve('approved')
  return new Promise((resolve) => {
    const requestId = randomUUID()
    pendingApprovals.set(requestId, { resolve, chatId })
    if (!win.isDestroyed()) {
      win.webContents.send(IPC.ApprovalRequest, { chatId, requestId, summary })
    }
    // Fail closed after 3 minutes of silence — but report it as a TIMEOUT, not a denial.
    setTimeout(() => {
      if (pendingApprovals.has(requestId)) {
        pendingApprovals.delete(requestId)
        resolve('timeout')
      }
    }, 180_000)
  })
}

/**
 * Long agent runs (a 10-post batch ≈ 50-60 tool calls) resend every tool output
 * every round — cost balloons and very long runs can blow the context window and
 * die mid-batch. Old tool outputs are stale (the page has changed); keep only the
 * most recent ones at full length.
 */
function pruneOldToolOutputs(turns: ChatTurn[], keepFull = 10, cap = 300): void {
  const toolIdxs: number[] = []
  for (let i = 0; i < turns.length; i++) if (turns[i].role === 'tool') toolIdxs.push(i)
  for (let k = 0; k < toolIdxs.length - keepFull; k++) {
    const t = turns[toolIdxs[k]] as { content: string }
    if (t.content.length > cap + 60) t.content = t.content.slice(0, cap) + ' …[older step, trimmed]'
  }
}

/** Extract the target count from a batch request ("…for 10 posts"), else 0. */
function parseBatchTarget(text: string): number {
  const m =
    text.match(/\b(\d{1,3})\s*(posts?|tweets?|comments?|replies|reply)\b/i) ||
    text.match(/\bfor\s+(\d{1,3})\b/i)
  if (m) {
    const n = parseInt(m[1], 10)
    if (n >= 2 && n <= 100) return n
  }
  return 0
}

const VERIFY_PROMPT = `You are Nori's quality reviewer. You get a user's original request and a
draft report. Judge ONLY whether the draft actually satisfies the request:
- Right ENTITY TYPE? (people/channels vs videos/articles — a common failure)
- Every stated constraint met (location, topic, count)?
- Items concrete and plausibly verified (names, handles, links) — not filler?
If it satisfies the request, reply exactly: PASS
Otherwise reply with a short bullet list of the concrete problems to fix. Be strict.`

/**
 * One chat thread per tab (chatId == tabId). Agentic loop: the model may call
 * tools (navigate/read_page/save_pdf) any number of rounds up to a cap, then
 * streams its final answer. Steps surface in the sidebar as a live timeline.
 */
export async function sendMessage(
  win: BrowserWindow,
  chatId: string,
  userText: string,
  pageContext?: string,
  ctx?: AgentCtx
): Promise<{ chatId: string; messageId: string }> {
  const now = Date.now()
  autoApproveChats.delete(chatId) // batch pre-authorization is per-message only
  const userMsg: ChatMessage = {
    id: randomUUID(),
    chatId,
    role: 'user',
    content: userText,
    model: null,
    costUsd: null,
    createdAt: now
  }
  store.addMessage(userMsg)

  const assistantMsg: ChatMessage = {
    id: randomUUID(),
    chatId,
    role: 'assistant',
    content: '',
    model: null,
    costUsd: null,
    createdAt: now + 1
  }
  store.addMessage(assistantMsg)

  // The model's training data ends long before today — without the real date it
  // searches for stale years ("trending topics 2023") and trusts outdated content.
  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  })
  const turns: ChatTurn[] = [
    {
      role: 'system',
      content: `${SYSTEM_PROMPT}\n\nTODAY'S DATE: ${today}. Your training data is OLDER than this — never put a past year (like 2023) into search queries unless the user asks for it; for current/trending asks search with today-relative terms, and judge freshness of results against TODAY'S date.`
    }
  ]
  if (pageContext) {
    turns.push({
      role: 'system',
      content: `Context — the user's current page:\n${trimToBudget(pageContext, 6000)}`
    })
  }
  const history = store.getMessages(chatId).slice(-HISTORY_TURNS - 2, -1)
  let used = 0
  const keep: ChatTurn[] = []
  for (let i = history.length - 1; i >= 0; i--) {
    const t = estimateTokens(history[i].content)
    if (used + t > HISTORY_TOKEN_BUDGET) break
    keep.unshift({ role: history[i].role, content: history[i].content })
    used += t
  }
  turns.push(...keep)

  ;(async () => {
    let totalIn = 0
    let totalOut = 0
    let finalText = ''
    let model = ''
    let verified = false
    try {
      const tier = pickTier(userText)
      const batchTarget = parseBatchTarget(userText) // 0 if not a "do N" request
      let postsSucceeded = 0
      let nudges = 0
      let userDenied = false // the user said no — the batch must stop, never nudge past it
      let approvalTimedOut = false // nobody at the screen — stop and suggest Autopilot
      for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
        const lastRound = round === MAX_TOOL_ROUNDS
        pruneOldToolOutputs(turns)
        const runRound = () =>
          streamChat(
            tier,
            turns,
            (delta) => {
              if (!win.isDestroyed()) {
                win.webContents.send(IPC.ChatChunk, { chatId, messageId: assistantMsg.id, delta })
              }
            },
            undefined,
            lastRound ? undefined : AGENT_TOOLS // force an answer on the final round
          )
        let result: Awaited<ReturnType<typeof runRound>>
        try {
          result = await runRound()
        } catch (err) {
          // Context overflow mid-batch: prune HARD and retry the round once instead
          // of killing the whole run.
          if (/context.?length|maximum context|too many tokens/i.test(String(err))) {
            pruneOldToolOutputs(turns, 4, 200)
            result = await runRound()
          } else {
            throw err
          }
        }
        totalIn += result.inputTokens
        totalOut += result.outputTokens
        model = result.model
        finalText += result.text

        if (result.toolCalls.length === 0) {
          // MECHANICAL BATCH GUARANTEE: if the model stopped mid-batch — INCLUDING at
          // zero, where it announced a plan ("I'll start commenting now…") and quit —
          // nudge it to keep going instead of ending the run early. Never nudge past an
          // explicit user denial or an unattended approval timeout.
          if (
            batchTarget > 0 &&
            postsSucceeded < batchTarget &&
            !userDenied &&
            !approvalTimedOut &&
            nudges < 8 &&
            round < MAX_TOOL_ROUNDS - 3
          ) {
            nudges++
            if (result.text) turns.push({ role: 'assistant', content: result.text })
            turns.push({
              role: 'user',
              content:
                postsSucceeded === 0
                  ? `You have posted 0 of ${batchTarget}. You wrote text instead of acting — announcing a plan or listing target posts and stopping is a FAILURE. Do not reply with any more prose. Act NOW: if you already have post urls from find_posts, call navigate on the first one; otherwise navigate to an x.com/search?q=<topic>&f=live page and call find_posts. Then for each post: read_page → read_form → fill_form → submit_form, until ${batchTarget} are posted.`
                  : `You have posted ${postsSucceeded} of ${batchTarget}. Do NOT stop or summarize — CONTINUE NOW with the next post (open the next url from find_posts → read_page → fill_form → submit_form). Keep going until ${batchTarget} are posted.`
            })
            finalText = '' // this progress note isn't the final answer
            continue
          }
          break
        }

        // Record the assistant's tool request, then execute each tool.
        turns.push({
          role: 'assistant',
          content: result.text || null,
          tool_calls: result.toolCalls.map((tc) => ({
            id: tc.id,
            type: 'function' as const,
            function: { name: tc.name, arguments: tc.arguments }
          }))
        })
        for (const tc of result.toolCalls) {
          let args: Record<string, unknown> = {}
          try {
            args = JSON.parse(tc.arguments || '{}')
          } catch {
            // malformed args — the tool will report the error back to the model
          }

          // Deep-verify: before a PDF is saved, a strict reviewer checks the
          // draft against the original ask. One bounce max, then it may save.
          if (tc.name === 'save_pdf' && !verified) {
            verified = true
            if (!win.isDestroyed()) {
              win.webContents.send(IPC.ChatStep, { chatId, label: 'Reviewing the draft…' })
            }
            const review = await completeChat('smart', [
              { role: 'system', content: VERIFY_PROMPT },
              {
                role: 'user',
                content: `Original request:\n${userText}\n\nDraft report titled "${String(
                  args.title ?? ''
                )}":\n${String(args.markdown ?? '')}`
              }
            ])
            totalIn += review.inputTokens
            totalOut += review.outputTokens
            if (!/^\s*PASS\b/.test(review.text)) {
              turns.push({
                role: 'tool',
                content: JSON.stringify({
                  verification: 'FAILED — PDF not saved',
                  problems: review.text,
                  instruction:
                    'Fix these problems. Gather more real data with search_web/navigate/read_page if needed, then call save_pdf again with the corrected report.'
                }),
                tool_call_id: tc.id
              })
              continue
            }
          }

          if (!win.isDestroyed()) {
            win.webContents.send(IPC.ChatStep, { chatId, label: stepLabel(tc.name, args) })
          }

          // Hard human-in-the-loop gate: nothing that commits (submits a form, or
          // clicks a pay/order/delete/post-type button) runs without explicit approval
          // (unless the user pre-authorized via "Approve all" or the Autopilot setting).
          const committingClick =
            tc.name === 'click' &&
            /\b(buy|pay|order|checkout|purchase|place\s?order|subscribe|donate|confirm|delete|remove|unsubscribe|book\s?now|pay\s?now|send|post|publish)\b/i.test(
              String(args.target ?? '')
            )
          if (tc.name === 'submit_form' || committingClick) {
            const verdict = await requestApproval(
              win,
              chatId,
              committingClick
                ? `Click “${String(args.target ?? '')}” — this looks like an action that commits (payment, order, post, or deletion).`
                : String(args.summary ?? 'Submit this form')
            )
            if (verdict !== 'approved') {
              if (verdict === 'denied') userDenied = true
              else approvalTimedOut = true
              turns.push({
                role: 'tool',
                content: JSON.stringify(
                  verdict === 'denied'
                    ? {
                        ok: false,
                        denied: true,
                        message:
                          'The user DENIED this submission. Do not retry. Ask what they want to change.'
                      }
                    : {
                        ok: false,
                        timedOut: true,
                        message:
                          'The approval request went unanswered for 3 minutes — nobody is at the screen. Nothing was posted. STOP the batch now and summarize honestly what was and was not posted; tell the user they can turn on Autopilot (in the chat panel) so future batches run without waiting for clicks.'
                      }
                ),
                tool_call_id: tc.id
              })
              continue
            }
          }

          const output = await executeTool(
            tc.name,
            args,
            ctx ?? { getWc: () => null, tabs: undefined as never }
          )
          if (tc.name === 'submit_form') {
            try {
              if (JSON.parse(output)?.ok === true) postsSucceeded++
            } catch {
              /* ignore */
            }
          }
          turns.push({ role: 'tool', content: output, tool_call_id: tc.id })
        }
      }

      const usd = costUsd(model, totalIn, totalOut)
      store.updateMessage(assistantMsg.id, { content: finalText, model, costUsd: usd })
      store.logCost(model, totalIn, totalOut, usd)
      if (!win.isDestroyed()) {
        win.webContents.send(IPC.ChatDone, {
          chatId,
          messageId: assistantMsg.id,
          inputTokens: totalIn,
          outputTokens: totalOut,
          costUsd: usd,
          content: finalText
        })
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Something went wrong.'
      store.updateMessage(assistantMsg.id, { content: finalText || `⚠ ${message}` })
      if (!win.isDestroyed()) {
        win.webContents.send(IPC.ChatError, { chatId, messageId: assistantMsg.id, message })
      }
    }
  })()

  return { chatId, messageId: assistantMsg.id }
}
