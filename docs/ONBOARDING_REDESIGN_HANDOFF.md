# Galactly Onboarding Redesign - Handoff Document

**Created:** January 31, 2026  
**Purpose:** Merge light theme visual design with existing Firebase authentication logic  
**Target File:** `docs/auth/signup/index.html`

---

## 🎯 Project Overview

**What We're Building:**  
A premium, light-themed onboarding experience that preserves all existing authentication logic while updating the visual design to match the new Galactly platform aesthetic.

**Key Price Point Context:** $2,000/month minimum → Enterprise-grade feel required

---

## 🎨 Visual Design Requirements

### Color System (Light Theme)
```css
/* Primary Colors */
--bg-primary: #FAFAFA;           /* Main background */
--bg-secondary: #FFFFFF;         /* Card/surface background */
--bg-elevated: #FFFFFF;          /* Elevated elements */

/* Text Colors */
--text-primary: #0F172A;         /* Main text */
--text-secondary: #475569;       /* Secondary text */
--text-muted: #94A3B8;           /* Muted/placeholder text */

/* Accent Colors */
--accent-primary: #3B82F6;       /* Primary blue */
--accent-hover: #2563EB;         /* Hover state */
--accent-subtle: rgba(59, 130, 246, 0.08);  /* Subtle backgrounds */

/* Borders & Surfaces */
--border: rgba(0, 0, 0, 0.08);
--border-focus: rgba(59, 130, 246, 0.4);
--surface: rgba(255, 255, 255, 0.8);
--surface-hover: rgba(255, 255, 255, 0.95);
```

### Design Aesthetic
- **Stripe/Linear/Apple inspired** - Clean, minimal, professional
- **Glass morphism** - Frosted white cards with subtle backdrop blur
- **Smooth 280ms animations** - Not rushed, purposeful transitions
- **Professional blue accents** - Trust-building, enterprise-appropriate
- **Subtle gradient background** - Very light blue radial gradients

### Animation Philosophy
```css
--duration-fast: 180ms;
--duration-normal: 280ms;
--duration-slow: 400ms;
--ease-smooth: cubic-bezier(0.4, 0, 0.2, 1);
--ease-bounce: cubic-bezier(0.34, 1.56, 0.64, 1);
```

---

## 🔧 Existing Logic to Preserve

### 1. Firebase Authentication System
**Location:** Inline `<script>` section at bottom of existing `index.html`

**Components:**
- Firebase initialization with fallback config loading
- Auth state management
- Firestore database connection

**DO NOT CHANGE:**
```javascript
// Firebase config loading (supports multiple sources)
const FIREBASE_CONFIG = 
  (window.__FIREBASE_CONFIG__ && typeof window.__FIREBASE_CONFIG__==='object' && window.__FIREBASE_CONFIG__) ||
  (typeof window.firebaseConfig!=='undefined' && window.firebaseConfig) ||
  META_CFG || { /* fallback config */ };
```

### 2. Domain Intelligence System
**Critical Feature:** Automatic company detection from email domain

**Key Functions to Preserve:**
- `extractHostFromEmail(email)` - Extracts domain from email
- `checkDomainBeforeSignup(domain, email)` - Checks domain claim status
- `claimDomainAfterSignup(domain, email, uid, status)` - Creates/updates domain claim
- `finalizeClaim(domain, email)` - Upgrades pending claims to verified

**Domain Claim States:**
- `free` - Domain available for claiming
- `pending-self` - User started signup but didn't verify
- `pending-other` - Someone else is claiming this domain
- `claimed-verified-self` - User already owns this domain (redirect to login)
- `claimed-verified-other` - Domain owned by someone else (redirect to login)
- `unavailable` - Firestore timeout/error

**Domain Claim Schema (Firestore `domainClaims` collection):**
```javascript
{
  owner: "user@company.com",      // Email of claimer
  uid: "firebase_uid",            // Firebase UID
  status: "pending" | "verified", // Claim status
  createdAt: Timestamp,
  verifiedAt: Timestamp | null
}
```

### 3. Security & Rate Limiting System
**Adaptive Challenge System:** Turnstile/hCaptcha shown only when risky behavior detected

**Risk Tracking Logic:**
```javascript
// Risk state stored in localStorage
const RISK_KEY = 'gg_risk_v1';

// Risk events tracked:
{ 
  t: timestamp,
  a: action ('email_precheck', 'password_signup', 'google_signin'),
  em: email,
  dm: domain 
}

// Challenge triggers:
- totalCount >= POLICY.maxTriesBeforeChallenge (default: 3)
- distinctEmails >= POLICY.distinctEmailsBeforeChallenge (default: 3)
- lastDelta < POLICY.throttleMs (default: 1200ms)
```

**Functions to Preserve:**
- `performHumanCheck(reason, meta)` - Decides if challenge needed
- `riskRecord(action, meta)` - Records attempt
- `riskShouldChallenge(reason, meta)` - Challenge logic
- `initHuman()` - Initializes Turnstile/hCaptcha
- `getHumanTokenInternal(reason)` - Executes challenge
- `verifyHumanServerSide(payload)` - Server-side verification

### 4. Email Verification Flow
**Critical:** Password signups require email verification before access

**Flow:**
1. User creates account with email/password
2. Account created but NOT logged in
3. Firebase sends verification email with action link
4. User clicks link → Returns to `/auth/bridge/` → Finalizes verification
5. Domain claim upgraded from `pending` to `verified`

**Key Storage Keys:**
- `EMAIL_KEY = 'gg_pending_email'` - Stores email waiting for verification
- `VERIFIED_KEY = 'gg_email_verified'` - Session flag for verified status

**Functions to Preserve:**
- `sendVerifyLink()` - Sends Firebase verification email
- `handleVerifyOnLoad()` - Processes verification on return from email
- `rollbackNewlyCreatedUser()` - Deletes user if domain claim fails

### 5. Google OAuth Flow
**Special Requirements:**
- Must use work email (personal Gmail blocked)
- Automatically marks email as verified (trusted provider)
- Creates VERIFIED domain claim immediately (no pending state)
- Redirects to login if account already exists

**Google-Specific Logic:**
```javascript
const isNew = cred?.additionalUserInfo?.isNewUser === true;

if (!isNew) {
  // Account exists → redirect to login
  await auth.signOut();
  goLogin(email);
  return;
}

// New account → create VERIFIED claim
const claim = await claimDomainAfterSignup(domain, email, user?.uid, 'verified');
```

### 6. Personal Domain Blocking
**Requirement:** Only business emails allowed

**Personal Domains List:**
```javascript
const PERSONAL = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "ymail.com",
  "outlook.com", "hotmail.com", "live.com", "msn.com",
  "icloud.com", "me.com", "mac.com", "aol.com",
  "proton.me", "protonmail.com", "pm.me", "mail.com",
  "yandex.com", "yandex.ru", "gmx.com", "zoho.com",
  "fastmail.com", "hey.com", "inbox.com"
]);

function isBusinessEmail(email) {
  const host = extractHostFromEmail(email);
  return !!(host && !PERSONAL.has(host.toLowerCase()));
}
```

---

## 🎯 User Flow (CORRECT VERSION)

### Step 1: Role Selection ✅
**Current Implementation:** Correct  
**Description:** User chooses Supplier or Buyer

**Preserve:**
- Role stored in `window.role`
- Two-column card layout
- Selection persistence

### Step 2: Email + Password/Google ✅
**Current Implementation:** Correct  
**Description:** Authentication with domain intelligence

**Key Features to Preserve:**

1. **Site Badge** (shows detected domain):
   ```html
   <div id="siteBadge" class="site-badge" hidden>
     <span>We'll use <span class="host" id="siteHost">—</span></span>
     <!-- Info tooltip explaining domain match -->
   </div>
   ```

2. **Two-Stage Email Flow:**
   - **Stage 1 ("start"):** Email input + Google button
   - **Stage 2 ("password"):** Password input shown AFTER email precheck passes
   
3. **Email Next Arrow:**
   - Hidden until valid business email entered
   - Checks domain claim status before showing password field
   - May show verification panel if user started signup earlier

4. **Verification Panel:**
   ```html
   <div id="verifyPanel" class="inline-note" hidden>
     We sent a verification link to <strong id="vEmail">—</strong>...
     <a id="resendLink">Resend</a> · <a id="changeEmail">Use a different email</a>
   </div>
   ```

5. **Password Field:**
   - Only shown AFTER email precheck succeeds
   - Has own "next" arrow that appears when 6+ characters entered
   - Creates account + sends verification email + shows verification panel

### Step 3: DOES NOT EXIST ❌
**CRITICAL:** There is NO manual company details step!

**Why:** Company information is extracted automatically from email domain using domain intelligence system.

**What happens instead:**
- After email verification → User redirected to `/auth/bridge/`
- Bridge page handles:
  - Finalizing domain claim (pending → verified)
  - Setting up user profile
  - Redirecting to main dashboard/onboarding

---

## 🚨 Critical Integration Points

### 1. Replace Progress Dots
**Current:** 3 dots (suggests 3 steps)  
**Should be:** 2 dots (role → email/auth)

```html
<!-- BEFORE (incorrect - 3 dots) -->
<div class="progress-indicator">
  <div class="progress-dot active" data-step="1"></div>
  <div class="progress-dot" data-step="2"></div>
  <div class="progress-dot" data-step="3"></div>
</div>

<!-- AFTER (correct - 2 dots) -->
<div class="progress-indicator">
  <div class="progress-dot active" data-step="1"></div>
  <div class="progress-dot" data-step="2"></div>
</div>
```

### 2. Remove Step 3 Entirely
**Delete:**
- All Step 3 HTML (company name, website, team size inputs)
- All Step 3 JavaScript logic
- All references to `goToStep(3)`

### 3. Update Step 2 Completion
**Replace:**
```javascript
// OLD (goes to Step 3)
showAlert('Account created successfully!', 'success');
setTimeout(() => goToStep(3), 600);

// NEW (shows verification panel)
verifyPanel.hidden = false;
vEmail.textContent = user.email || email;
updateLoginLink();
hideStatus();
```

### 4. Update "Back" Button Behavior
**Current behavior:** Step 2 → Step 1 (correct)  
**Broken behavior:** Step 3 → Step 2 (remove this)

### 5. Preserve Dynamic UI States
**s2Stage variable tracks UI state:**
- `'start'` - Shows Google button + email field
- `'password'` - Shows password field (email locked)

**Functions that manage this:**
- `toPasswordStage()` - Switches from start → password
- `showStartStage()` - Resets to start stage

---

## 🎨 Visual Translation Guide

### Dark Theme → Light Theme Mappings

| Current (Dark) | New (Light) | Usage |
|----------------|-------------|-------|
| `#0c1020` | `#FAFAFA` | Background |
| `rgba(255,255,255,.08)` | `#FFFFFF` | Cards |
| `rgba(255,255,255,.15)` | `rgba(0,0,0,.08)` | Borders |
| `rgba(255,255,255,.25)` | `rgba(59,130,246,.4)` | Focus borders |
| `#e9ecf3` | `#0F172A` | Primary text |
| `#a9b2c2` | `#475569` | Secondary text |
| `#f4d06f` (gold) | `#3B82F6` (blue) | Accent color |

### Component Translations

**1. Choice Cards (Role Selection):**
```css
/* OLD (dark + gold accent) */
.choice.selected {
  outline: 2px solid #f4d06f;
  box-shadow: 0 0 0 6px rgba(244,208,111,.15);
}

/* NEW (light + blue accent) */
.card.selected {
  background: rgba(59, 130, 246, 0.08);
  border-color: #3B82F6;
}
```

**2. Input Fields:**
```css
/* OLD (dark inset) */
.pressed {
  box-shadow: inset 0 1px 0 rgba(255,255,255,.02),
              inset 0 -3px 6px rgba(0,0,0,.58);
}

/* NEW (light elevated) */
.input-wrapper {
  background: #FFFFFF;
  border: 1px solid rgba(0, 0, 0, 0.08);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.03);
}

.input-wrapper:focus-within {
  border-color: #3B82F6;
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.08);
}
```

**3. Buttons:**
```css
/* OLD (dark glass) */
.btn-icon {
  background: linear-gradient(180deg, rgba(255,255,255,.08), rgba(255,255,255,.04));
  border: 1px solid rgba(255,255,255,.18);
}

/* NEW (light elevated) */
.btn-primary {
  background: #3B82F6;
  color: white;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
}

.btn-secondary {
  background: #FFFFFF;
  border: 1px solid rgba(0, 0, 0, 0.08);
}
```

---

## 📋 Implementation Checklist

### Phase 1: Color System
- [ ] Replace all CSS custom properties with light theme values
- [ ] Update body background (remove dark gradients, add subtle light blue)
- [ ] Adjust text colors (dark text on light backgrounds)
- [ ] Change accent from gold (`#f4d06f`) to blue (`#3B82F6`)

### Phase 2: Component Styling
- [ ] Update `.choice` cards (light glass with blue accents)
- [ ] Update input fields (light elevated style)
- [ ] Update buttons (light surface + blue primary)
- [ ] Update alerts/status boxes (light colored backgrounds)
- [ ] Update dividers (light gray)

### Phase 3: Structure Changes
- [ ] Remove progress dot #3
- [ ] Delete entire Step 3 HTML section
- [ ] Delete Step 3 JavaScript logic
- [ ] Remove `goToStep(3)` calls
- [ ] Update completion flow to show verification panel

### Phase 4: Preserve Core Logic
- [ ] Keep all Firebase initialization code
- [ ] Keep domain intelligence functions
- [ ] Keep security/rate limiting system
- [ ] Keep email verification flow
- [ ] Keep Google OAuth logic
- [ ] Keep personal domain blocking
- [ ] Keep site badge functionality

### Phase 5: Test Critical Paths
- [ ] Role selection → proceeds to Step 2
- [ ] Email input → shows/hides CTA arrow correctly
- [ ] Business email validation → blocks personal domains
- [ ] Email precheck → checks domain claim status
- [ ] Domain already claimed → redirects to login
- [ ] Password signup → sends verification email
- [ ] Verification panel → shows with resend/change options
- [ ] Google OAuth → blocks personal Gmail
- [ ] Google OAuth new user → creates verified claim
- [ ] Google OAuth existing user → redirects to login

---

## 🎯 Key Files Reference

### Source Files
- **Visual Design Reference:** This handoff document (color system above)
- **Logic Reference:** `docs/auth/signup/index.html` (existing file)
- **Target Output:** Updated `docs/auth/signup/index.html`

### External Dependencies (Preserved)
```html
<!-- Firebase SDK -->
<script src="https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js"></script>
<script src="https://www.gstatic.com/firebasejs/10.12.0/firebase-auth-compat.js"></script>
<script src="https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore-compat.js"></script>

<!-- Google Identity Services -->
<script src="https://accounts.google.com/gsi/client" async defer></script>

<!-- Human Verification -->
<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
<script src="https://js.hcaptcha.com/1/api.js" async defer></script>
```

### Config Requirements
```html
<!-- Firebase Config (multiple source support) -->
<script>
  window.__FIREBASE_CONFIG__ = { /* config */ };
</script>

<!-- Security Config (adaptive challenge) -->
<script>
  window.__SECURITY__ = {
    turnstileSiteKey: "",
    hcaptchaSiteKey: "",
    humanVerifyEndpoint: "",
    policy: { /* rate limit config */ }
  };
</script>
```

---

## 🚀 Final Output Requirements

### File Structure
```
docs/auth/signup/index.html
├── <!DOCTYPE html>
├── <head>
│   ├── Meta tags (viewport, charset)
│   ├── <title>Galactly — Onboarding</title>
│   ├── Firebase/Security config <script> blocks
│   ├── Google Fonts (Plus Jakarta Sans for headings)
│   ├── <style> (light theme CSS - all inline)
│   └── External script tags (Firebase, Google, challenges)
├── <body>
│   ├── Topbar (logo + home link)
│   ├── <main class="wrap">
│   │   └── <div class="stage cardless">
│   │       ├── Step 1: Role Selection (supplier/buyer)
│   │       └── Step 2: Email/Password/Google + Verification
│   ├── Hidden elements (#human-zone for challenges)
│   └── <script> (all auth/domain/security logic - inline)
└── </html>
```

### Critical: Single-File Architecture
- All CSS inline in `<style>` tag
- All JavaScript inline in `<script>` tag (except external CDN scripts)
- No separate CSS/JS files
- All logic preserved from existing implementation

### Code Quality Standards
- Keep existing function names unchanged
- Preserve all comments explaining complex logic
- Maintain existing error handling patterns
- Keep timeout configurations
- Preserve localStorage/sessionStorage key names

---

## 💡 Implementation Strategy

### Recommended Approach
1. **Copy existing file** as starting point
2. **Replace `<style>` section** with light theme CSS (use color mappings above)
3. **Delete Step 3** HTML and JavaScript
4. **Update progress dots** (3 → 2)
5. **Adjust completion flows** (remove Step 3 references)
6. **Test all critical paths** (see checklist above)

### What NOT to Change
- Firebase initialization logic
- Domain intelligence functions
- Security/rate limiting system
- Email verification flow
- Google OAuth implementation
- Error handling patterns
- Storage key names
- External script URLs
- Config loading fallbacks

### What TO Change
- CSS color values (dark → light)
- Number of progress dots (3 → 2)
- Step 3 removal (entire section)
- Completion redirects (Step 3 → verification panel)

---

## 🎓 Context for AI Agent

**You are being asked to:**
1. Take the existing authentication file (`docs/auth/signup/index.html`)
2. Apply the light theme visual design (colors/styles from this document)
3. Remove the incorrect Step 3 (company details)
4. Preserve ALL authentication, security, and domain intelligence logic

**DO NOT:**
- Rewrite the authentication system
- Change how domain claiming works
- Remove security features
- Modify email verification flow
- Change storage keys or function names

**DO:**
- Apply light theme colors consistently
- Remove Step 3 and all references to it
- Update progress indicators (3 → 2 dots)
- Keep all existing business logic intact
- Maintain single-file architecture

---

## 📞 Questions?

If anything is unclear, reference:
- **Visual design:** Color system section above
- **Existing logic:** Current `docs/auth/signup/index.html` file
- **Flow diagram:** User Flow section above

**Key principle:** This is a VISUAL REDESIGN with structural cleanup (Step 3 removal), NOT a logic rewrite.

---

**Ready to implement!** 🚀