# Attendance Page Logic

Yeh document project ke daily attendance page ka current end-to-end behavior batata hai. Page ka route `src/app/(workspace)/attendance/page.tsx` hai; uska UI aur client-side flow `src/components/workspace-panel.tsx` mein hai.

## Phase 1: Page kholna aur access check

1. `/attendance` route `WorkspaceSectionPage` ko `attendance` section aur `attendance.read` permission ke saath render karta hai.
2. Workspace layout pehle user session check karta hai. Login na ho to `/login` par redirect hota hai.
3. Attendance page ke liye `attendance.read` permission zaroori hai. Permission na ho to user ko unauthorized page dikhaya jata hai.
4. Page outlets load karta hai. User ko sirf uske accessible outlets milte hain; inactive outlets attendance entry ke liye list mein nahi aate.
5. `MAIN_ADMIN` ke paas permissions role ke basis par milti hain. Baaki users ke permissions user/designation configuration ya legacy outlet defaults se aate hain.

## Phase 2: Date, outlet aur attendance data load

1. Date default mein aaj ki hoti hai. Screen par date `DD-MM-YYYY` format mein dikhayi jaati hai (jaise `29-10-2026`); UI future date select nahi karne deta.
2. Server future date ke liye request reject karta hai. Server ka “aaj” payroll settings ke timezone, `BUSINESS_TIMEZONE`, ya fallback `Asia/Kolkata` se calculate hota hai.
3. Ek accessible active outlet ho to woh auto-select hota hai. Zyada outlets hon to user ek outlet ya “All accessible outlets” view chun sakta hai.
4. Screen par date `DD-MM-YYYY` hoti hai, lekin API ke saath date hamesha `YYYY-MM-DD` format mein bheji jaati hai (jaise `2026-10-29`). Yeh backend ka required format hai; display format ko API format na samjhein.
5. Outlet + date ke liye UI `GET /api/attendance?outletId=...&date=YYYY-MM-DD` call karta hai.
6. “All accessible outlets” ke liye UI `GET /api/attendance?date=YYYY-MM-DD` call karta hai.
7. API selected outlet ke active employees ko attendance ke saath laati hai. Us din attendance record mein maujood inactive employees bhi historical record dekhne ke liye include ho sakte hain.
8. Outlet-specific response mein outlet/day details, employee entries aur `P`, `A`, `WO`, `HD` counts milte hain. All-outlets response mein outlet-wise submission summary aur combined employee list milti hai.
9. Koi entry nahi hai ya entry `unmarked` hai to UI us employee ko “Not marked” dikhata hai. Day record na ho to day status “Draft · not submitted” ke roop mein nazar aata hai.

## Phase 3: Employee attendance mark karna

Har employee ke liye yeh statuses hain:

| Code | Meaning |
|---|---|
| `P` | Present |
| `A` | Absent |
| `WO` | Week off |
| `HD` | Half day |
| `null` | Mark nahi kiya gaya |

- Status button par click karne se selection UI state mein update hota hai; is waqt database mein save nahi hota.
- Wahi selected status dobara click karne se selection clear ho jata hai. Draft save par pehle se saved unsubmitted entry bhi clear ho jaati hai.
- Status buttons har unsubmitted employee ke liye available rehte hain; save/submit ke liye `attendance.write` permission zaroori hai.
- Sirf apni submitted attendance wale employee ki row non-`MAIN_ADMIN` users ke liye locked hoti hai. `MAIN_ADMIN` submitted rows ko bhi edit kar sakta hai.
- Correction limit save/submit ke waqt server par validate hoti hai; woh unsubmitted row ke status buttons ko disable nahi karti.
- Marked count aur status counts current page data se calculate hote hain. Unmarked entries status counts mein nahi aati.

## Phase 4: Draft save karna

1. “Save draft” button tab active hota hai jab kam se kam ek unlocked employee marked ho.
2. UI `PUT /api/attendance` par `action: "SAVE"` bhejta hai. Payload mein outlet, date, employee/status entries aur pehle se saved unsubmitted status clear karne ke liye `clearEmployeeIds` ho sakte hain.
3. Server schema check karta hai: date, outlet/employee IDs, maximum 500 entries/clear IDs, aur allowed status values.
4. Server yeh bhi verify karta hai ki har employee selected outlet ka active employee ho ya us din ke existing historical entries/correction records mein ho, aur payload mein employee duplicate na ho.
5. New day record `DRAFT` state se create ho sakta hai. Entry ke saath status, update time/user, correction count aur submission flag store hote hain.
6. Draft save ke baad data reload hota hai aur latest server state UI mein dikhayi jaati hai.

## Phase 5: Attendance submit aur lock

1. Submit ke liye user ko `attendance.write` aur `attendance.submit` dono permissions chahiye.
2. Kam se kam ek unlocked employee marked hona chahiye; sirf blank entries submit nahi ki ja sakti.
3. `MAIN_ADMIN` ko submit se pehle confirmation dialog dikhaya jata hai. Us confirmation ki preference browser ke `localStorage` mein user email ke saath save hoti hai.
4. Submit request sirf marked, abhi tak unsubmitted entries ko `submitted: true` karti hai; unmarked employees ko default status nahi diya jata.
5. Submitted employee entries non-admin users ke liye lock ho jaati hain. Unmarked aur draft employees unlocked rehte hain; isliye ek hi din mein alag submissions karke baaki employees baad mein mark/submit kiye ja sakte hain.
6. All-outlets view mein save/submit har outlet ke liye alag request bhejta hai. Jis outlet mein marked employees hain woh submit hota hai; sirf unmarked existing entries wale outlet ke liye save request ho sakti hai. Ek outlet fail ho to doosre outlets ke successful results preserve hote hain aur failed outlets ka error dikhaya jata hai.
7. Submit par `ATTENDANCE_SUBMITTED` audit event likha jata hai. Day ka submit time/user bhi record hota hai.
8. Submitted row ko outlet user edit, re-submit, ya delete karne ki API request bheje to server `403` deta hai. `MAIN_ADMIN` submitted status badalne ya clear karne ke liye correction reason deta hai; correction history aur audit log maintain hote hain.
9. Concurrent update ya locked data ke case mein server conflict (`409`) deta hai; UI error display karta hai.

## Phase 6: Submitted attendance unlock aur correction

1. Submitted attendance unlock karne ka UI tabhi aata hai jab user ke paas `attendance.unlock` permission ho. Multi-outlet view mein unlock action outlet-specific hota hai.
2. Unlock API `POST /api/attendance/unlock` use karti hai. Server sirf `MAIN_ADMIN` ko allow karta hai, chahe kisi aur role ko permission assign ki gayi ho.
3. Unlock ke waqt optional reason (maximum 500 characters) liya ja sakta hai. Reason na dene par default reason `Unlocked by MAIN_ADMIN` store hota hai.
4. Unlock day ka status `DRAFT` karta hai, sab entries ko `submitted: false` set karta hai, aur correction history mein `UNLOCK` event add karta hai. `ATTENDANCE_UNLOCKED` audit event bhi likha jata hai.
5. Unlock ke baad staff users correction kar sakte hain. Non-admin user ke liye har employee ka correction count save hota rehta hai; unlock ke baad status badalne par yeh count badhta hai. Count 2 pahunchne ke baad non-admin user us employee ko aage edit nahi kar sakta, chahe attendance phir se unlock hui ho. `MAIN_ADMIN` par yeh do-change limit apply nahi hoti.
6. Correction ke baad dobara submit karne par day phir `SUBMITTED` hota hai aur history mein `RELOCK` event add hota hai.
7. Correction history mein action, time, actor aur reason rehte hain; page latest correction reason aur event count dikhata hai.

## Phase 7: Reports aur payroll par asar

- Employee attendance report missing days, unsubmitted days aur marked status dates alag-alag track karta hai.
- Report mein kisi day ka status `SUBMITTED` na ho to woh day submitted attendance totals mein count nahi hota.
- Live accrued salary/report calculation submitted attendance days ko use karti hai.
- Payroll preview aur generation bhi submitted day records se attendance leti hai; zaroori submitted attendance entry missing ho to payroll operation reject ho sakta hai.
- Dashboard aur Attendance outlet summary mein outlet tabhi submitted count hota hai jab us date ke **saare active employees** ki entries submitted hon. Partial submissions se submitted employees lock rehte hain, lekin outlet completion pending rehti hai.

## Data aur API ka quick reference

- MongoDB collection: `attendance`
- Ek day record ki pehchaan: `outletId` + `date`
- Day status: `DRAFT` ya `SUBMITTED`
- Entry status: `P`, `A`, `WO`, `HD`; unmarked state `unmarked` se represent ho sakti hai
- Read: `GET /api/attendance`
- Save/submit: `PUT /api/attendance`
- Unlock: `POST /api/attendance/unlock`
- Attendance validation: `src/lib/validation/business.ts` ka `attendanceSchema`
- Attendance document types: `src/lib/models.ts`
- Report aggregation: `src/app/api/reports/employee-attendance/route.ts`
