/* ==========================================================================
   MuscleSync — application logic
   Architecture note: all persistence currently goes through the DB.* helpers
   below, which wrap localStorage. To move to a real backend, only DB.*
   needs to change to call an API — nothing else in the app touches
   localStorage directly. Auth.* is similarly isolated for a future
   server-side auth swap.
   ========================================================================== */

const STORAGE_KEY = "musclesync_v1";
const DAY_NAMES = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];
const DAY_SHORT = {Monday:"Mon",Tuesday:"Tue",Wednesday:"Wed",Thursday:"Thu",Friday:"Fri",Saturday:"Sat",Sunday:"Sun"};

/* ==========================================================================
   DB — persistence layer (localStorage today, API-ready shape tomorrow)
   ========================================================================== */
const DB = {
  _read(){
    try{
      const raw = localStorage.getItem(STORAGE_KEY);
      if(!raw) return DB._seed();
      return JSON.parse(raw);
    }catch(e){
      console.warn("MuscleSync: storage read failed, reseeding", e);
      return DB._seed();
    }
  },
  _write(db){
    try{ localStorage.setItem(STORAGE_KEY, JSON.stringify(db)); }
    catch(e){ console.warn("MuscleSync: storage write failed", e); }
  },
  _seed(){
    const db = {
      users: {
        admin: { password: "admin", isAdmin: true, createdAt: Date.now() }
      },
      userdata: {
        admin: DB.blankUserData()
      },
      settings: { appVersion: "1.0.0", seededAt: Date.now() }
    };
    DB._write(db);
    return db;
  },
  blankUserData(){
    return {
      onboarded: false,
      profile: { name:"", age:null, gender:"other", height_cm:null, weight_kg:null, targetWeight_kg:null, bodyFat:null, experience:"beginner" },
      goal: { type:"recomp", rateKgPerWeek:0.35, priority:"balanced" },
      gym: { hasGym:false, name:"", equipment:[], preferredDays:[], maxDuration:60, preferredTime:"evening", homeEquipment:[] },
      foods: { likes:{ protein:[], carbs:[], veg:[], fruit:[] }, custom:[], dislikes:[], restrictions:[] },
      supplements: [],
      routine: { wake:"07:00", bed:"23:00", mealsPerDay:3, snacksPerDay:2, waterGoalL:2.5, cookingAbility:"moderate", maxPrepMin:30, eatAtWork:true, fridgeAtWork:true, microwaveAtWork:true },
      weeks: {},
      plans: {},
      progress: [],
      checklist: {},
      mealSwaps: {},
      shoppingChecks: {}
    };
  },
  get(){ return DB._read(); },
  save(db){ DB._write(db); },
  getUserData(username){
    const db = DB.get();
    if(!db.userdata[username]) db.userdata[username] = DB.blankUserData();
    return db.userdata[username];
  },
  saveUserData(username, data){
    const db = DB.get();
    db.userdata[username] = data;
    DB._write(db);
  }
};

/* ==========================================================================
   Auth — isolated so it can be swapped for real server-side auth later
   ========================================================================== */
const Auth = {
  SESSION_KEY: "musclesync_session",
  currentUser(){ return sessionStorage.getItem(Auth.SESSION_KEY); },
  login(username, password){
    const db = DB.get();
    const u = db.users[username];
    if(!u || u.password !== password) return { ok:false, error:"Incorrect username or password." };
    sessionStorage.setItem(Auth.SESSION_KEY, username);
    return { ok:true };
  },
  signup(username, password){
    const db = DB.get();
    if(!username || username.length < 3) return { ok:false, error:"Username must be at least 3 characters." };
    if(!password || password.length < 4) return { ok:false, error:"Password must be at least 4 characters." };
    if(db.users[username]) return { ok:false, error:"That username is already taken." };
    db.users[username] = { password, isAdmin:false, createdAt: Date.now() };
    db.userdata[username] = DB.blankUserData();
    DB._write(db);
    sessionStorage.setItem(Auth.SESSION_KEY, username);
    return { ok:true };
  },
  logout(){ sessionStorage.removeItem(Auth.SESSION_KEY); }
};

/* ==========================================================================
   Small utilities
   ========================================================================== */
function toast(msg, kind){
  const host = document.getElementById("toastHost");
  const el = document.createElement("div");
  el.className = "toast" + (kind ? " " + kind : "");
  el.textContent = msg;
  host.appendChild(el);
  setTimeout(()=>{ el.style.transition="opacity .25s"; el.style.opacity="0"; setTimeout(()=>el.remove(),260); }, 2400);
}
function timeToMin(t){ if(!t) return null; const [h,m] = t.split(":").map(Number); return h*60+m; }
function minToTime(m){
  m = ((m % 1440) + 1440) % 1440;
  const h = Math.floor(m/60), mm = m%60;
  return String(h).padStart(2,"0")+":"+String(mm).padStart(2,"0");
}
function fmt12(t){
  const m = timeToMin(t); if(m===null) return "--";
  let h = Math.floor(m/60), mm = m%60;
  const ampm = h>=12 ? "PM":"AM";
  h = h%12; if(h===0) h=12;
  return `${h}:${String(mm).padStart(2,"0")} ${ampm}`;
}
function addMin(t, delta){ return minToTime(timeToMin(t)+delta); }
function clampNum(n,min,max){ return Math.max(min, Math.min(max, n)); }
function uid(){ return Math.random().toString(36).slice(2,9); }
function round(n,d=0){ const f=Math.pow(10,d); return Math.round(n*f)/f; }
function esc(s){ return String(s==null?"":s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }

function getMonday(d){
  const date = new Date(d);
  const day = date.getDay();
  const diff = (day === 0 ? -6 : 1) - day;
  date.setDate(date.getDate() + diff);
  date.setHours(0,0,0,0);
  return date;
}
function isoDate(d){ return d.toISOString().slice(0,10); }
function weekKeyFor(offsetWeeks){
  const now = new Date();
  const mon = getMonday(now);
  mon.setDate(mon.getDate() + offsetWeeks*7);
  return isoDate(mon);
}
function weekLabel(weekKey){
  const d = new Date(weekKey+"T00:00:00");
  const end = new Date(d); end.setDate(end.getDate()+6);
  const opts = {month:"short", day:"numeric"};
  return `${d.toLocaleDateString(undefined,opts)} – ${end.toLocaleDateString(undefined,opts)}`;
}
function dateForDayInWeek(weekKey, dayName){
  const idx = DAY_NAMES.indexOf(dayName);
  const d = new Date(weekKey+"T00:00:00");
  d.setDate(d.getDate()+idx);
  return isoDate(d);
}
function todayDayName(){
  const idx = new Date().getDay();
  return DAY_NAMES[idx===0?6:idx-1];
}

/* ==========================================================================
   App state
   ========================================================================== */
const App = {
  user: null,
  data: null,
  currentPage: "home",
  currentWeekOffset: 0,
  currentWorkoutDay: null,
  onbStep: 0,
  onbDraft: null,

  init(){
    const u = Auth.currentUser();
    bindAuthScreen();
    bindGlobalNav();
    if(u){
      App.user = u;
      App.data = DB.getUserData(u);
      if(!App.data.onboarded){
        showScreen("onboarding");
        startOnboarding();
      } else {
        showScreen("app");
        App.currentWorkoutDay = todayDayName();
        goToPage("home");
      }
    } else {
      showScreen("auth");
    }
  },
  save(){ DB.saveUserData(App.user, App.data); }
};

function showScreen(name){
  ["auth","onboarding","app"].forEach(s=>{
    document.getElementById("screen-"+s).classList.toggle("hidden", s!==name);
  });
}

/* ==========================================================================
   AUTH SCREEN
   ========================================================================== */
function bindAuthScreen(){
  document.querySelectorAll(".auth-tab").forEach(tab=>{
    tab.addEventListener("click", ()=>{
      document.querySelectorAll(".auth-tab").forEach(t=>t.classList.remove("active"));
      tab.classList.add("active");
      const which = tab.dataset.tab;
      document.getElementById("loginForm").classList.toggle("hidden", which!=="login");
      document.getElementById("signupForm").classList.toggle("hidden", which!=="signup");
    });
  });
  document.getElementById("loginForm").addEventListener("submit", e=>{
    e.preventDefault();
    const username = document.getElementById("loginUsername").value.trim();
    const password = document.getElementById("loginPassword").value;
    const res = Auth.login(username, password);
    if(!res.ok){ toast(res.error, "error"); return; }
    App.user = username;
    App.data = DB.getUserData(username);
    toast(`Welcome back, ${username}.`, "success");
    if(!App.data.onboarded){ showScreen("onboarding"); startOnboarding(); }
    else { showScreen("app"); App.currentWorkoutDay = todayDayName(); goToPage("home"); }
  });
  document.getElementById("signupForm").addEventListener("submit", e=>{
    e.preventDefault();
    const username = document.getElementById("signupUsername").value.trim();
    const password = document.getElementById("signupPassword").value;
    const res = Auth.signup(username, password);
    if(!res.ok){ toast(res.error, "error"); return; }
    App.user = username;
    App.data = DB.getUserData(username);
    toast("Account created.", "success");
    showScreen("onboarding");
    startOnboarding();
  });
}

/* ==========================================================================
   GLOBAL NAV
   ========================================================================== */
function bindGlobalNav(){
  document.querySelectorAll(".nav-btn").forEach(btn=>{
    btn.addEventListener("click", ()=> goToPage(btn.dataset.page));
  });
  document.getElementById("logoutBtn").addEventListener("click", ()=>{
    Auth.logout();
    App.user = null; App.data = null;
    showScreen("auth");
    toast("Logged out.");
  });
  document.getElementById("modalBackdrop").addEventListener("click", closeModal);
}

const PAGE_META = {
  home: {title:"Home", sub:()=> new Date().toLocaleDateString(undefined,{weekday:"long", month:"long", day:"numeric"})},
  week: {title:"My Week", sub:()=>"Plan your availability"},
  workout: {title:"Workout", sub:()=> App.data.gym.hasGym ? App.data.gym.name || "Gym plan" : "Home workout plan"},
  nutrition: {title:"Nutrition", sub:()=>"Meals, macros & groceries"},
  progress: {title:"Progress", sub:()=>"Track your transformation"},
  profile: {title:"Profile", sub:()=> App.data.profile.name || App.user},
};

function goToPage(page){
  if(page === "admin" && !isAdminUser()) page = "home";
  App.currentPage = page;
  document.querySelectorAll(".nav-btn").forEach(b=> b.classList.toggle("active", b.dataset.page===page));
  document.querySelectorAll(".page").forEach(p=> p.classList.toggle("hidden", p.dataset.page!==page));
  const meta = PAGE_META[page] || {title:"Admin", sub:()=>"Local demo data"};
  document.getElementById("pageTitle").textContent = meta.title;
  document.getElementById("pageSubtitle").textContent = meta.sub();
  window.scrollTo(0,0);
  render(page);
}
function isAdminUser(){
  const db = DB.get();
  return db.users[App.user] && db.users[App.user].isAdmin;
}
function render(page){
  if(page==="home") renderHome();
  else if(page==="week") renderWeek();
  else if(page==="workout") renderWorkout();
  else if(page==="nutrition") renderNutrition();
  else if(page==="progress") renderProgress();
  else if(page==="profile") renderProfile();
  else if(page==="admin") renderAdmin();
}

/* ==========================================================================
   MODAL SYSTEM
   ========================================================================== */
function openModal(html){
  document.getElementById("modalInner").innerHTML = html;
  document.getElementById("modalHost").classList.remove("hidden");
}
function closeModal(){
  document.getElementById("modalHost").classList.add("hidden");
  document.getElementById("modalInner").innerHTML = "";
}

/* ==========================================================================
   ONBOARDING WIZARD
   ========================================================================== */
const ONB_STEPS = ["personal","goal","gym","foods","dislikes","supplements","routine","schedule"];

function startOnboarding(){
  App.onbStep = 0;
  App.onbDraft = JSON.parse(JSON.stringify(App.data));
  document.getElementById("onbNext").addEventListener("click", onbNext, {once:false});
  document.getElementById("onbBack").addEventListener("click", onbBack, {once:false});
  renderOnbStep();
}
function onbNext(){
  if(!onbValidate()) return;
  onbCollect();
  if(App.onbStep < ONB_STEPS.length-1){ App.onbStep++; renderOnbStep(); }
  else finishOnboarding();
}
function onbBack(){
  if(App.onbStep===0) return;
  onbCollect();
  App.onbStep--;
  renderOnbStep();
}
function finishOnboarding(){
  App.onbDraft.onboarded = true;
  // seed current week schedule from defaults if empty
  const wk = weekKeyFor(0);
  if(!App.onbDraft.weeks[wk]) App.onbDraft.weeks[wk] = defaultWeekSchedule(App.onbDraft);
  App.data = App.onbDraft;
  App.save();
  toast("Profile complete. Let's build your plan.", "success");
  showScreen("app");
  App.currentWorkoutDay = todayDayName();
  goToPage("home");
}

function defaultWeekSchedule(data){
  const days = {};
  DAY_NAMES.forEach(d=>{
    const weekend = d==="Saturday" || d==="Sunday";
    days[d] = {
      off: weekend,
      workStart: weekend ? "" : "09:00",
      workEnd: weekend ? "" : "17:00",
      commuteMin: weekend ? 0 : 20,
      wake: data.routine.wake,
      sleep: data.routine.bed
    };
  });
  return { days };
}

function onbProgress(){
  document.getElementById("onbProgressFill").style.width = (((App.onbStep)/(ONB_STEPS.length-1))*100)+"%";
  document.getElementById("onbStepLabel").textContent = `Step ${App.onbStep+1} of ${ONB_STEPS.length}`;
  document.getElementById("onbBack").style.visibility = App.onbStep===0 ? "hidden":"visible";
  document.getElementById("onbNext").textContent = App.onbStep===ONB_STEPS.length-1 ? "Finish setup" : "Continue";
}

function renderOnbStep(){
  onbProgress();
  const step = ONB_STEPS[App.onbStep];
  const body = document.getElementById("onbBody");
  const d = App.onbDraft;
  if(step==="personal"){
    body.innerHTML = `
      <h2>Tell us about you</h2>
      <p class="onb-sub">This grounds every calculation MuscleSync makes for you.</p>
      <label class="field"><span>Full name</span><input id="f_name" value="${esc(d.profile.name)}" placeholder="Alex Rivera"></label>
      <div class="field-row">
        <label class="field"><span>Age</span><input id="f_age" type="number" min="14" max="90" value="${d.profile.age??""}"></label>
        <label class="field"><span>Gender</span>
          <select id="f_gender">
            <option value="male" ${d.profile.gender==="male"?"selected":""}>Male</option>
            <option value="female" ${d.profile.gender==="female"?"selected":""}>Female</option>
            <option value="other" ${d.profile.gender==="other"?"selected":""}>Other</option>
          </select>
        </label>
      </div>
      <div class="field-row">
        <label class="field"><span>Height (cm)</span><input id="f_height" type="number" min="120" max="230" value="${d.profile.height_cm??""}"></label>
        <label class="field"><span>Current weight (kg)</span><input id="f_weight" type="number" min="30" max="300" step="0.1" value="${d.profile.weight_kg??""}"></label>
      </div>
      <div class="field-row">
        <label class="field"><span>Target weight (kg)</span><input id="f_target" type="number" min="30" max="300" step="0.1" value="${d.profile.targetWeight_kg??""}"></label>
        <label class="field"><span>Body fat % (optional)</span><input id="f_bf" type="number" min="3" max="60" value="${d.profile.bodyFat??""}"></label>
      </div>
      <div class="field"><span>Fitness experience</span>
        <div class="chip-grid" id="f_experience">
          ${["beginner","intermediate","advanced"].map(x=>`<div class="chip ${d.profile.experience===x?"active":""}" data-val="${x}">${x[0].toUpperCase()+x.slice(1)}</div>`).join("")}
        </div>
      </div>`;
    bindChipGroup("f_experience");
  }
  else if(step==="goal"){
    const goals = [
      {v:"lose", t:"Lose weight", d:"Reduce body fat while preserving as much muscle as possible."},
      {v:"muscle", t:"Build muscle", d:"Prioritize strength and size, in a calorie surplus."},
      {v:"recomp", t:"Build muscle + lose fat", d:"Recomposition: gradual fat loss while gaining strength and muscle."},
      {v:"maintain", t:"Maintain weight", d:"Keep your current weight steady while improving fitness."},
      {v:"fitness", t:"Improve fitness", d:"Focus on performance, energy and consistency over the scale."},
    ];
    body.innerHTML = `
      <h2>What's your main goal?</h2>
      <p class="onb-sub">This drives your calorie target and how your week is structured.</p>
      <div id="f_goaltype">
        ${goals.map(g=>`<div class="option-card ${d.goal.type===g.v?"active":""}" data-val="${g.v}"><h4>${g.t}</h4><p>${g.d}</p></div>`).join("")}
      </div>
      <div id="recompExtra" class="${d.goal.type==="recomp"?"":"hidden"}" style="margin-top:6px;">
        <p class="onb-sub" style="margin-bottom:10px;">Aggressive calorie restriction can interfere with muscle gain — we'll keep your deficit moderate.</p>
        <label class="field"><span>Desired rate of weight loss (kg/week)</span>
          <select id="f_rate">
            <option value="0.2" ${d.goal.rateKgPerWeek===0.2?"selected":""}>Gentle — 0.2 kg/week</option>
            <option value="0.35" ${d.goal.rateKgPerWeek===0.35?"selected":""}>Moderate — 0.35 kg/week</option>
            <option value="0.5" ${d.goal.rateKgPerWeek===0.5?"selected":""}>Faster — 0.5 kg/week</option>
          </select>
        </label>
        <label class="field"><span>Muscle-building priority</span>
          <select id="f_priority">
            <option value="balanced" ${d.goal.priority==="balanced"?"selected":""}>Balanced</option>
            <option value="muscle" ${d.goal.priority==="muscle"?"selected":""}>Prioritize muscle retention</option>
            <option value="fatloss" ${d.goal.priority==="fatloss"?"selected":""}>Prioritize fat loss</option>
          </select>
        </label>
      </div>`;
    document.querySelectorAll("#f_goaltype .option-card").forEach(c=>{
      c.addEventListener("click", ()=>{
        document.querySelectorAll("#f_goaltype .option-card").forEach(x=>x.classList.remove("active"));
        c.classList.add("active");
        document.getElementById("recompExtra").classList.toggle("hidden", c.dataset.val!=="recomp");
      });
    });
  }
  else if(step==="gym"){
    const eqOptions = ["Barbell","Dumbbells","Bench","Squat rack","Cable machine","Lat pulldown","Leg press","Smith machine","Machines","Cardio equipment","Other"];
    const homeOptions = ["None","Dumbbells","Resistance bands","Pull-up bar","Bench","Other"];
    body.innerHTML = `
      <h2>Gym access</h2>
      <p class="onb-sub">We'll tailor your workouts to what's actually available to you.</p>
      <div class="field"><span>Do you have access to a gym?</span>
        <div class="chip-grid" id="f_hasgym">
          <div class="chip ${d.gym.hasGym?"active":""}" data-val="yes">Yes</div>
          <div class="chip ${!d.gym.hasGym?"active":""}" data-val="no">No</div>
        </div>
      </div>
      <div id="gymYes" class="${d.gym.hasGym?"":"hidden"}">
        <label class="field"><span>Gym name (optional)</span><input id="f_gymname" value="${esc(d.gym.name)}" placeholder="Iron Temple Fitness"></label>
        <div class="field"><span>Available equipment</span>
          <div class="chip-grid" id="f_equipment">${eqOptions.map(e=>`<div class="chip ${d.gym.equipment.includes(e)?"active":""}" data-val="${e}">${e}</div>`).join("")}</div>
        </div>
        <div class="field"><span>Preferred training days</span>
          <div class="chip-grid" id="f_prefdays">${DAY_NAMES.map(dn=>`<div class="chip ${d.gym.preferredDays.includes(dn)?"active":""}" data-val="${dn}">${DAY_SHORT[dn]}</div>`).join("")}</div>
        </div>
        <div class="field-row">
          <label class="field"><span>Max workout duration (min)</span><input id="f_maxdur" type="number" min="15" max="180" value="${d.gym.maxDuration}"></label>
          <label class="field"><span>Preferred time</span>
            <select id="f_preftime">
              <option value="morning" ${d.gym.preferredTime==="morning"?"selected":""}>Morning</option>
              <option value="afternoon" ${d.gym.preferredTime==="afternoon"?"selected":""}>Afternoon</option>
              <option value="evening" ${d.gym.preferredTime==="evening"?"selected":""}>Evening</option>
            </select>
          </label>
        </div>
      </div>
      <div id="gymNo" class="${d.gym.hasGym?"hidden":""}">
        <div class="field"><span>Home equipment available</span>
          <div class="chip-grid" id="f_homeequip">${homeOptions.map(e=>`<div class="chip ${d.gym.homeEquipment.includes(e)?"active":""}" data-val="${e}">${e}</div>`).join("")}</div>
        </div>
        <div class="field"><span>Preferred training days</span>
          <div class="chip-grid" id="f_prefdays2">${DAY_NAMES.map(dn=>`<div class="chip ${d.gym.preferredDays.includes(dn)?"active":""}" data-val="${dn}">${DAY_SHORT[dn]}</div>`).join("")}</div>
        </div>
        <div class="field-row">
          <label class="field"><span>Max workout duration (min)</span><input id="f_maxdur2" type="number" min="10" max="120" value="${d.gym.maxDuration}"></label>
          <label class="field"><span>Preferred time</span>
            <select id="f_preftime2">
              <option value="morning" ${d.gym.preferredTime==="morning"?"selected":""}>Morning</option>
              <option value="afternoon" ${d.gym.preferredTime==="afternoon"?"selected":""}>Afternoon</option>
              <option value="evening" ${d.gym.preferredTime==="evening"?"selected":""}>Evening</option>
            </select>
          </label>
        </div>
      </div>`;
    bindToggleGroup("f_hasgym", val=>{
      document.getElementById("gymYes").classList.toggle("hidden", val!=="yes");
      document.getElementById("gymNo").classList.toggle("hidden", val==="yes");
    });
    bindChipGroup("f_equipment", true);
    bindChipGroup("f_prefdays", true);
    bindChipGroup("f_homeequip", true);
    bindChipGroup("f_prefdays2", true);
  }
  else if(step==="foods"){
    const cats = {
      protein:["Chicken","Beef","Turkey","Fish","Tuna","Eggs","Greek yogurt","Cottage cheese","Tofu","Lentils"],
      carbs:["Rice","Pasta","Potatoes","Oats","Bread","Couscous","Quinoa","Sweet potato"],
      veg:["Broccoli","Spinach","Lettuce","Tomato","Cucumber","Carrots","Peppers","Zucchini"],
      fruit:["Banana","Apple","Orange","Berries","Grapes","Mango"]
    };
    body.innerHTML = `
      <h2>Foods you like</h2>
      <p class="onb-sub">Your meal plan will be built from these. Pick as many as you'd actually eat.</p>
      ${Object.entries(cats).map(([cat,items])=>`
        <div class="field"><span>${cat[0].toUpperCase()+cat.slice(1)}</span>
          <div class="chip-grid" id="f_food_${cat}">${items.map(i=>`<div class="chip ${d.foods.likes[cat].includes(i)?"active":""}" data-val="${i}">${i}</div>`).join("")}</div>
        </div>`).join("")}
      <label class="field"><span>Add a custom food (comma-separated)</span>
        <input id="f_customfood" placeholder="e.g. Salmon, Paneer" value="${esc((d.foods.custom||[]).join(", "))}">
      </label>`;
    Object.keys(cats).forEach(cat=> bindChipGroup("f_food_"+cat, true));
  }
  else if(step==="dislikes"){
    const restrictions = ["Vegetarian","Vegan","Halal","Kosher","Gluten-free","Lactose intolerant"];
    body.innerHTML = `
      <h2>Foods to avoid</h2>
      <p class="onb-sub">We will never place these in your generated meals.</p>
      <label class="field"><span>Foods you dislike or are allergic to (comma-separated)</span>
        <input id="f_dislikes" placeholder="e.g. Mushrooms, Shellfish" value="${esc((d.foods.dislikes||[]).join(", "))}">
      </label>
      <div class="field"><span>Dietary restrictions</span>
        <div class="chip-grid" id="f_restrictions">${restrictions.map(r=>`<div class="chip ${d.foods.restrictions.includes(r)?"active":""}" data-val="${r}">${r}</div>`).join("")}</div>
      </div>`;
    bindChipGroup("f_restrictions", true);
  }
  else if(step==="supplements"){
    body.innerHTML = `
      <h2>Supplements</h2>
      <p class="onb-sub">List what you currently take. MuscleSync will slot timing into your day but never invents dosages for you.</p>
      <div id="suppList"></div>
      <button type="button" class="btn btn-ghost btn-block" id="addSuppBtn">+ Add supplement</button>
      <p class="field-hint" style="margin-top:14px;">For supplements with medical interactions or individualized dosing, check with a healthcare professional before starting or changing anything.</p>`;
    renderSuppList(d.supplements);
    document.getElementById("addSuppBtn").addEventListener("click", ()=>{
      d.supplements.push({id:uid(), name:"", dose:"", frequency:"daily", timing:"morning", notes:""});
      renderSuppList(d.supplements);
    });
  }
  else if(step==="routine"){
    body.innerHTML = `
      <h2>Daily routine</h2>
      <p class="onb-sub">Your baseline sleep and eating rhythm — you can still override specific days later.</p>
      <div class="field-row">
        <label class="field"><span>Usual wake-up time</span><input id="f_wake" type="time" value="${d.routine.wake}"></label>
        <label class="field"><span>Usual bedtime</span><input id="f_bed" type="time" value="${d.routine.bed}"></label>
      </div>
      <div class="field-row">
        <label class="field"><span>Meals per day</span><input id="f_mealsn" type="number" min="2" max="6" value="${d.routine.mealsPerDay}"></label>
        <label class="field"><span>Snacks per day</span><input id="f_snacksn" type="number" min="0" max="4" value="${d.routine.snacksPerDay}"></label>
      </div>
      <label class="field"><span>Daily water goal (liters)</span><input id="f_water" type="number" min="1" max="6" step="0.1" value="${d.routine.waterGoalL}"></label>
      <div class="field-row">
        <label class="field"><span>Cooking ability</span>
          <select id="f_cooking">
            <option value="minimal" ${d.routine.cookingAbility==="minimal"?"selected":""}>Minimal</option>
            <option value="moderate" ${d.routine.cookingAbility==="moderate"?"selected":""}>Moderate</option>
            <option value="advanced" ${d.routine.cookingAbility==="advanced"?"selected":""}>Advanced</option>
          </select>
        </label>
        <label class="field"><span>Max prep time (min)</span><input id="f_prepmin" type="number" min="5" max="120" value="${d.routine.maxPrepMin}"></label>
      </div>
      <div class="field"><span>At work, do you eat meals there?</span>
        <div class="chip-grid" id="f_eatwork">
          <div class="chip ${d.routine.eatAtWork?"active":""}" data-val="yes">Yes</div>
          <div class="chip ${!d.routine.eatAtWork?"active":""}" data-val="no">No</div>
        </div>
      </div>
      <div class="field-row">
        <div class="field"><span>Fridge at work?</span>
          <div class="chip-grid" id="f_fridge">
            <div class="chip ${d.routine.fridgeAtWork?"active":""}" data-val="yes">Yes</div>
            <div class="chip ${!d.routine.fridgeAtWork?"active":""}" data-val="no">No</div>
          </div>
        </div>
        <div class="field"><span>Microwave at work?</span>
          <div class="chip-grid" id="f_micro">
            <div class="chip ${d.routine.microwaveAtWork?"active":""}" data-val="yes">Yes</div>
            <div class="chip ${!d.routine.microwaveAtWork?"active":""}" data-val="no">No</div>
          </div>
        </div>
      </div>`;
    bindToggleGroup("f_eatwork"); bindToggleGroup("f_fridge"); bindToggleGroup("f_micro");
  }
  else if(step==="schedule"){
    if(!App.onbDraftWeek) App.onbDraftWeek = defaultWeekSchedule(d);
    body.innerHTML = `
      <h2>This week's schedule</h2>
      <p class="onb-sub">Set your work hours for each day. You can edit any week later from "My Week".</p>
      <div id="onbWeekEditor"></div>`;
    renderWeekEditorInto(document.getElementById("onbWeekEditor"), App.onbDraftWeek, true);
  }
}

function renderSuppList(list){
  const host = document.getElementById("suppList");
  if(!list.length){ host.innerHTML = `<p class="faint" style="font-size:13px; margin-bottom:10px;">No supplements added yet.</p>`; return; }
  host.innerHTML = list.map((s,i)=>`
    <div class="day-editor">
      <div class="day-editor-head"><h4>Supplement ${i+1}</h4><button type="button" class="btn btn-sm btn-danger" data-remove="${s.id}">Remove</button></div>
      <label class="field"><span>Name</span><input data-supp="${s.id}" data-field="name" value="${esc(s.name)}" placeholder="e.g. Creatine monohydrate"></label>
      <div class="field-row">
        <label class="field"><span>Dose</span><input data-supp="${s.id}" data-field="dose" value="${esc(s.dose)}" placeholder="e.g. 5g"></label>
        <label class="field"><span>Frequency</span>
          <select data-supp="${s.id}" data-field="frequency">
            <option value="daily" ${s.frequency==="daily"?"selected":""}>Daily</option>
            <option value="workout-days" ${s.frequency==="workout-days"?"selected":""}>Workout days only</option>
            <option value="as-needed" ${s.frequency==="as-needed"?"selected":""}>As needed</option>
          </select>
        </label>
      </div>
      <label class="field"><span>Preferred timing</span>
        <select data-supp="${s.id}" data-field="timing">
          <option value="morning" ${s.timing==="morning"?"selected":""}>Morning</option>
          <option value="pre-workout" ${s.timing==="pre-workout"?"selected":""}>Pre-workout</option>
          <option value="post-workout" ${s.timing==="post-workout"?"selected":""}>Post-workout</option>
          <option value="evening" ${s.timing==="evening"?"selected":""}>Evening</option>
        </select>
      </label>
      <label class="field"><span>Notes (optional)</span><input data-supp="${s.id}" data-field="notes" value="${esc(s.notes)}"></label>
    </div>`).join("");
  host.querySelectorAll("[data-supp]").forEach(input=>{
    input.addEventListener("input", ()=>{
      const supp = list.find(x=>x.id===input.dataset.supp);
      supp[input.dataset.field] = input.value;
    });
  });
  host.querySelectorAll("[data-remove]").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      const idx = list.findIndex(x=>x.id===btn.dataset.remove);
      list.splice(idx,1);
      renderSuppList(list);
    });
  });
}

function bindChipGroup(id, multi){
  const host = document.getElementById(id);
  if(!host) return;
  host.querySelectorAll(".chip").forEach(chip=>{
    chip.addEventListener("click", ()=>{
      if(multi){ chip.classList.toggle("active"); }
      else { host.querySelectorAll(".chip").forEach(c=>c.classList.remove("active")); chip.classList.add("active"); }
    });
  });
}
function bindToggleGroup(id, onChange){
  const host = document.getElementById(id);
  if(!host) return;
  host.querySelectorAll(".chip").forEach(chip=>{
    chip.addEventListener("click", ()=>{
      host.querySelectorAll(".chip").forEach(c=>c.classList.remove("active"));
      chip.classList.add("active");
      if(onChange) onChange(chip.dataset.val);
    });
  });
}
function getActiveChips(id){
  const host = document.getElementById(id);
  if(!host) return [];
  return [...host.querySelectorAll(".chip.active")].map(c=>c.dataset.val);
}
function getActiveChip(id){
  const host = document.getElementById(id);
  if(!host) return null;
  const el = host.querySelector(".chip.active");
  return el ? el.dataset.val : null;
}

function onbValidate(){
  const step = ONB_STEPS[App.onbStep];
  if(step==="personal"){
    const age = +document.getElementById("f_age").value;
    const h = +document.getElementById("f_height").value;
    const w = +document.getElementById("f_weight").value;
    if(!document.getElementById("f_name").value.trim()){ toast("Please enter your name.","error"); return false; }
    if(!age || age<14 || age>90){ toast("Please enter a realistic age.","error"); return false; }
    if(!h || h<120 || h>230){ toast("Please enter a realistic height.","error"); return false; }
    if(!w || w<30 || w>300){ toast("Please enter a realistic weight.","error"); return false; }
  }
  if(step==="routine"){
    if(timeToMin(document.getElementById("f_wake").value)===null || timeToMin(document.getElementById("f_bed").value)===null){
      toast("Please set both wake and bed times.","error"); return false;
    }
  }
  return true;
}

function onbCollect(){
  const step = ONB_STEPS[App.onbStep];
  const d = App.onbDraft;
  if(step==="personal"){
    d.profile.name = document.getElementById("f_name").value.trim();
    d.profile.age = +document.getElementById("f_age").value;
    d.profile.gender = document.getElementById("f_gender").value;
    d.profile.height_cm = +document.getElementById("f_height").value;
    d.profile.weight_kg = +document.getElementById("f_weight").value;
    d.profile.targetWeight_kg = +document.getElementById("f_target").value || d.profile.weight_kg;
    d.profile.bodyFat = document.getElementById("f_bf").value ? +document.getElementById("f_bf").value : null;
    d.profile.experience = getActiveChip("f_experience") || "beginner";
  }
  else if(step==="goal"){
    const active = document.querySelector("#f_goaltype .option-card.active");
    d.goal.type = active ? active.dataset.val : "recomp";
    if(d.goal.type==="recomp"){
      d.goal.rateKgPerWeek = +document.getElementById("f_rate").value;
      d.goal.priority = document.getElementById("f_priority").value;
    }
  }
  else if(step==="gym"){
    const hasGym = getActiveChip("f_hasgym")==="yes";
    d.gym.hasGym = hasGym;
    if(hasGym){
      d.gym.name = document.getElementById("f_gymname").value.trim();
      d.gym.equipment = getActiveChips("f_equipment");
      d.gym.preferredDays = getActiveChips("f_prefdays");
      d.gym.maxDuration = +document.getElementById("f_maxdur").value || 60;
      d.gym.preferredTime = document.getElementById("f_preftime").value;
    } else {
      d.gym.homeEquipment = getActiveChips("f_homeequip");
      d.gym.preferredDays = getActiveChips("f_prefdays2");
      d.gym.maxDuration = +document.getElementById("f_maxdur2").value || 45;
      d.gym.preferredTime = document.getElementById("f_preftime2").value;
    }
    if(d.gym.preferredDays.length===0) d.gym.preferredDays = ["Monday","Wednesday","Friday"];
  }
  else if(step==="foods"){
    ["protein","carbs","veg","fruit"].forEach(cat=>{
      d.foods.likes[cat] = getActiveChips("f_food_"+cat);
    });
    const custom = document.getElementById("f_customfood").value.split(",").map(s=>s.trim()).filter(Boolean);
    d.foods.custom = custom;
  }
  else if(step==="dislikes"){
    d.foods.dislikes = document.getElementById("f_dislikes").value.split(",").map(s=>s.trim()).filter(Boolean);
    d.foods.restrictions = getActiveChips("f_restrictions");
  }
  else if(step==="routine"){
    d.routine.wake = document.getElementById("f_wake").value;
    d.routine.bed = document.getElementById("f_bed").value;
    d.routine.mealsPerDay = +document.getElementById("f_mealsn").value || 3;
    d.routine.snacksPerDay = +document.getElementById("f_snacksn").value || 0;
    d.routine.waterGoalL = +document.getElementById("f_water").value || 2.5;
    d.routine.cookingAbility = document.getElementById("f_cooking").value;
    d.routine.maxPrepMin = +document.getElementById("f_prepmin").value || 30;
    d.routine.eatAtWork = getActiveChip("f_eatwork")!=="no";
    d.routine.fridgeAtWork = getActiveChip("f_fridge")!=="no";
    d.routine.microwaveAtWork = getActiveChip("f_micro")!=="no";
  }
  else if(step==="schedule"){
    collectWeekEditor(App.onbDraftWeek);
    const wk = weekKeyFor(0);
    d.weeks[wk] = App.onbDraftWeek;
  }
}

/* ==========================================================================
   WEEK SCHEDULE EDITOR (shared by onboarding + My Week page)
   ========================================================================== */
function renderWeekEditorInto(host, weekObj, compact){
  host.innerHTML = DAY_NAMES.map(day=>{
    const c = weekObj.days[day];
    return `
    <div class="day-editor" data-day="${day}">
      <div class="day-editor-head">
        <h4>${day}</h4>
        <label class="day-off-toggle"><input type="checkbox" data-role="off" ${c.off?"checked":""}> Day off</label>
      </div>
      <div class="day-fields" style="${c.off?"display:none;":""}">
        <div class="field-row">
          <label class="field"><span>Work start</span><input type="time" data-role="workStart" value="${c.workStart||""}"></label>
          <label class="field"><span>Work end</span><input type="time" data-role="workEnd" value="${c.workEnd||""}"></label>
        </div>
        <div class="field-row">
          <label class="field"><span>Wake</span><input type="time" data-role="wake" value="${c.wake||""}"></label>
          <label class="field"><span>Sleep</span><input type="time" data-role="sleep" value="${c.sleep||""}"></label>
        </div>
        <label class="field"><span>Commute (minutes, one-way)</span><input type="number" min="0" max="180" data-role="commuteMin" value="${c.commuteMin||0}"></label>
      </div>
      <div class="day-fields-off" style="${c.off?"":"display:none;"}">
        <div class="field-row">
          <label class="field"><span>Wake</span><input type="time" data-role="wakeOff" value="${c.wake||""}"></label>
          <label class="field"><span>Sleep</span><input type="time" data-role="sleepOff" value="${c.sleep||""}"></label>
        </div>
      </div>
      <button type="button" class="btn btn-ghost btn-sm" data-role="copyto" style="margin-top:6px;">Copy this day to…</button>
    </div>`;
  }).join("");

  host.querySelectorAll(".day-editor").forEach(ed=>{
    const day = ed.dataset.day;
    ed.querySelector('[data-role="off"]').addEventListener("change", (e)=>{
      ed.querySelector(".day-fields").style.display = e.target.checked ? "none":"block";
      ed.querySelector(".day-fields-off").style.display = e.target.checked ? "block":"none";
    });
    ed.querySelector('[data-role="copyto"]').addEventListener("click", ()=>{
      openCopyDayModal(day, weekObj, host, compact);
    });
  });
}
function collectWeekEditor(weekObj){
  document.querySelectorAll(".day-editor").forEach(ed=>{
    const day = ed.dataset.day;
    const off = ed.querySelector('[data-role="off"]').checked;
    if(off){
      weekObj.days[day] = {
        off:true,
        workStart:"", workEnd:"", commuteMin:0,
        wake: ed.querySelector('[data-role="wakeOff"]').value || weekObj.days[day].wake,
        sleep: ed.querySelector('[data-role="sleepOff"]').value || weekObj.days[day].sleep
      };
    } else {
      weekObj.days[day] = {
        off:false,
        workStart: ed.querySelector('[data-role="workStart"]').value,
        workEnd: ed.querySelector('[data-role="workEnd"]').value,
        commuteMin: +ed.querySelector('[data-role="commuteMin"]').value || 0,
        wake: ed.querySelector('[data-role="wake"]').value,
        sleep: ed.querySelector('[data-role="sleep"]').value
      };
    }
  });
}
function openCopyDayModal(fromDay, weekObj, host, compact){
  collectWeekEditor(weekObj);
  openModal(`
    <h3>Copy ${fromDay}'s schedule to…</h3>
    <div class="chip-grid" id="copyTargets">
      ${DAY_NAMES.filter(d=>d!==fromDay).map(d=>`<div class="chip" data-val="${d}">${DAY_SHORT[d]}</div>`).join("")}
    </div>
    <button class="btn btn-primary btn-block" style="margin-top:18px;" id="applyCopyBtn">Apply</button>
  `);
  bindChipGroup("copyTargets", true);
  document.getElementById("applyCopyBtn").addEventListener("click", ()=>{
    const targets = getActiveChips("copyTargets");
    targets.forEach(t=> weekObj.days[t] = JSON.parse(JSON.stringify(weekObj.days[fromDay])) );
    renderWeekEditorInto(host, weekObj, compact);
    closeModal();
    toast(`Copied to ${targets.length} day(s).`, "success");
  });
}

/* ==========================================================================
   NUTRITION DATA + MACRO CALCULATIONS
   ========================================================================== */
const FOOD_DB = {
  // per typical single-serving macros: {kcal, p, c, f, unit}
  "Chicken": {kcal:231, p:43, c:0, f:5, serving:"200g grilled chicken breast", tags:["protein"]},
  "Beef": {kcal:290, p:36, c:0, f:15, serving:"200g lean beef", tags:["protein"]},
  "Turkey": {kcal:220, p:42, c:0, f:5, serving:"200g turkey breast", tags:["protein"]},
  "Fish": {kcal:240, p:40, c:0, f:8, serving:"200g white fish", tags:["protein"]},
  "Tuna": {kcal:180, p:40, c:0, f:1, serving:"1 can tuna (185g)", tags:["protein"]},
  "Eggs": {kcal:280, p:24, c:2, f:20, serving:"3 whole eggs + 2 whites", tags:["protein"]},
  "Greek yogurt": {kcal:170, p:20, c:9, f:5, serving:"250g greek yogurt", tags:["protein","dairy"]},
  "Cottage cheese": {kcal:180, p:24, c:8, f:5, serving:"200g cottage cheese", tags:["protein","dairy"]},
  "Tofu": {kcal:180, p:18, c:4, f:11, serving:"250g firm tofu", tags:["protein","vegan"]},
  "Lentils": {kcal:230, p:18, c:40, f:1, serving:"1 cup cooked lentils", tags:["protein","carbs","vegan"]},
  "Rice": {kcal:280, p:6, c:60, f:1, serving:"1.5 cups cooked rice", tags:["carbs"]},
  "Pasta": {kcal:310, p:11, c:62, f:2, serving:"100g dry pasta, cooked", tags:["carbs","gluten"]},
  "Potatoes": {kcal:220, p:5, c:50, f:0, serving:"350g potatoes", tags:["carbs"]},
  "Oats": {kcal:300, p:11, c:52, f:6, serving:"80g dry oats", tags:["carbs"]},
  "Bread": {kcal:210, p:8, c:38, f:3, serving:"2 slices whole-grain bread", tags:["carbs","gluten"]},
  "Couscous": {kcal:280, p:9, c:58, f:1, serving:"1.5 cups cooked couscous", tags:["carbs","gluten"]},
  "Quinoa": {kcal:280, p:10, c:50, f:5, serving:"1.5 cups cooked quinoa", tags:["carbs"]},
  "Sweet potato": {kcal:220, p:4, c:51, f:0, serving:"350g sweet potato", tags:["carbs"]},
  "Broccoli": {kcal:55, p:5, c:10, f:0, serving:"200g broccoli", tags:["veg"]},
  "Spinach": {kcal:35, p:4, c:5, f:0, serving:"200g spinach", tags:["veg"]},
  "Lettuce": {kcal:20, p:1, c:4, f:0, serving:"large salad base", tags:["veg"]},
  "Tomato": {kcal:35, p:1, c:7, f:0, serving:"2 tomatoes", tags:["veg"]},
  "Cucumber": {kcal:25, p:1, c:5, f:0, serving:"1 cucumber", tags:["veg"]},
  "Carrots": {kcal:45, p:1, c:10, f:0, serving:"2 carrots", tags:["veg"]},
  "Peppers": {kcal:35, p:1, c:8, f:0, serving:"2 bell peppers", tags:["veg"]},
  "Zucchini": {kcal:30, p:2, c:6, f:0, serving:"1 zucchini", tags:["veg"]},
  "Banana": {kcal:105, p:1, c:27, f:0, serving:"1 banana", tags:["fruit"]},
  "Apple": {kcal:95, p:0, c:25, f:0, serving:"1 apple", tags:["fruit"]},
  "Orange": {kcal:65, p:1, c:16, f:0, serving:"1 orange", tags:["fruit"]},
  "Berries": {kcal:60, p:1, c:14, f:0, serving:"1 cup mixed berries", tags:["fruit"]},
  "Grapes": {kcal:105, p:1, c:27, f:0, serving:"1 cup grapes", tags:["fruit"]},
  "Mango": {kcal:100, p:1, c:25, f:0, serving:"1 cup mango", tags:["fruit"]},
  "Protein shake": {kcal:130, p:25, c:5, f:2, serving:"1 scoop whey/plant protein + water", tags:["protein","supplement"]},
};
function foodExcluded(name, data){
  const f = FOOD_DB[name];
  if(!f) return false;
  const dislikes = (data.foods.dislikes||[]).map(s=>s.toLowerCase());
  if(dislikes.includes(name.toLowerCase())) return true;
  const restr = data.foods.restrictions||[];
  const meatFish = ["Chicken","Beef","Turkey","Fish","Tuna"];
  const animal = [...meatFish,"Eggs","Greek yogurt","Cottage cheese"];
  if(restr.includes("Vegetarian") && meatFish.includes(name)) return true;
  if(restr.includes("Vegan") && animal.includes(name)) return true;
  if(restr.includes("Gluten-free") && f.tags.includes("gluten")) return true;
  if(restr.includes("Lactose intolerant") && f.tags.includes("dairy")) return true;
  return false;
}
function likedList(data, cat){
  const liked = data.foods.likes[cat]||[];
  const pool = liked.length ? liked : Object.keys(FOOD_DB).filter(f=>FOOD_DB[f].tags.includes(cat));
  return pool.filter(f => FOOD_DB[f] && !foodExcluded(f, data));
}

function calculateBMR(profile){
  const {gender, weight_kg, height_cm, age} = profile;
  const base = 10*weight_kg + 6.25*height_cm - 5*age;
  return gender==="male" ? base+5 : gender==="female" ? base-161 : base-78;
}
function activityMultiplier(experience, workoutDaysPerWeek){
  let base = 1.3; // sedentary-ish baseline + daily life
  base += Math.min(workoutDaysPerWeek,6)*0.055;
  if(experience==="advanced") base += 0.05;
  return round(base,2);
}
function calculateCalories(data){
  const bmr = calculateBMR(data.profile);
  const tdee = bmr * activityMultiplier(data.profile.experience, data.gym.preferredDays.length || 3);
  let target = tdee;
  const g = data.goal;
  if(g.type==="lose"){ target = tdee - 500; }
  else if(g.type==="muscle"){ target = tdee + 300; }
  else if(g.type==="recomp"){
    const weeklyDeficitKcal = (g.rateKgPerWeek||0.35) * 7700;
    let dailyDeficit = weeklyDeficitKcal/7;
    dailyDeficit = clampNum(dailyDeficit, 150, 500); // never too aggressive — protects muscle
    target = tdee - dailyDeficit;
  } else if(g.type==="maintain" || g.type==="fitness"){ target = tdee; }
  // safety floor
  const floor = data.profile.gender==="female" ? 1300 : 1500;
  target = Math.max(target, floor);
  return { bmr: round(bmr), tdee: round(tdee), target: round(target) };
}
function calculateMacros(data){
  const cals = calculateCalories(data);
  const bodyWeight = data.profile.weight_kg;
  let proteinPerKg = 1.8;
  if(data.goal.type==="muscle") proteinPerKg = 2.0;
  if(data.goal.type==="recomp" && data.goal.priority==="muscle") proteinPerKg = 2.2;
  if(data.goal.type==="lose") proteinPerKg = 2.0;
  const protein = round(bodyWeight * proteinPerKg);
  const fat = round((cals.target*0.27)/9);
  const proteinKcal = protein*4, fatKcal = fat*9;
  const carbs = round(Math.max(0, (cals.target - proteinKcal - fatKcal))/4);
  const water = round(Math.max(data.routine.waterGoalL, bodyWeight*0.033),1);
  return { calories: cals.target, tdee: cals.tdee, protein, carbs, fat, water };
}

/* ==========================================================================
   SCHEDULE ENGINE — the core synchronization logic
   ========================================================================== */
function isWorkoutDay(dayName, data, planCtx){
  // rotate through preferred days; fall back to auto-spread if user picked none
  return data.gym.preferredDays.includes(dayName);
}

function computeFreeWindows(wake, sleep, workStart, workEnd, commuteMin){
  const wakeM = timeToMin(wake), sleepM = timeToMin(sleep) < timeToMin(wake) ? timeToMin(sleep)+1440 : timeToMin(sleep);
  let busy = [];
  if(workStart && workEnd){
    const ws = timeToMin(workStart) - commuteMin;
    const we = timeToMin(workEnd) + commuteMin;
    busy.push([ws, we]);
  }
  busy.sort((a,b)=>a[0]-b[0]);
  const windows = [];
  let cursor = wakeM;
  busy.forEach(([s,e])=>{
    if(s > cursor) windows.push([cursor, Math.min(s, sleepM)]);
    cursor = Math.max(cursor, e);
  });
  if(cursor < sleepM) windows.push([cursor, sleepM]);
  return windows.filter(([s,e])=> e-s >= 15);
}

function pickWorkoutWindow(windows, preferredTime, duration, sleepM){
  const prefRange = { morning:[300,660], afternoon:[660,1020], evening:[1020,1380] }[preferredTime] || [1020,1380];
  // score windows by overlap with preferred range and available length, leave 40min wind-down before sleep
  let best = null, bestScore = -Infinity;
  windows.forEach(([s,e])=>{
    let usableEnd = Math.min(e, sleepM-40);
    let usableStart = s;
    if(usableEnd - usableStart < Math.min(duration,20)) return;
    const overlap = Math.max(0, Math.min(usableEnd, prefRange[1]) - Math.max(usableStart, prefRange[0]));
    const score = overlap*2 + (usableEnd-usableStart);
    if(score > bestScore){ bestScore = score; best = [usableStart, usableEnd]; }
  });
  if(!best) return null;
  const start = Math.max(best[0], Math.min(best[1]-duration, prefRange[0]>best[0] && prefRange[0]<best[1] ? prefRange[0] : best[0]));
  const actualDur = Math.min(duration, best[1]-start);
  return [start, start+actualDur];
}

function generateDayPlan(dayName, dayCfg, weekKey, data){
  const macros = calculateMacros(data);
  const restDay = dayCfg.off ? false : !isWorkoutDay(dayName, data);
  const wake = dayCfg.wake || data.routine.wake;
  const sleep = dayCfg.sleep || data.routine.bed;
  const wakeM = timeToMin(wake);
  let sleepM = timeToMin(sleep); if(sleepM <= wakeM) sleepM += 1440;
  const working = !dayCfg.off && dayCfg.workStart && dayCfg.workEnd;
  const windows = computeFreeWindows(wake, sleep, working?dayCfg.workStart:null, working?dayCfg.workEnd:null, dayCfg.commuteMin||0);

  const workoutToday = data.gym.preferredDays.includes(dayName);
  const workoutDuration = data.gym.maxDuration || 45;
  let workoutWindow = null;
  if(workoutToday){
    workoutWindow = pickWorkoutWindow(windows, data.gym.preferredTime, workoutDuration, sleepM);
  }

  const events = [];
  events.push({time:minToTime(wakeM), type:"wake", title:"Wake up", why:""});
  events.push({time:minToTime(wakeM+10), type:"water", title:"Water — 500ml", why:"Rehydrating first thing supports metabolism and alertness."});

  // breakfast
  let breakfastM = wakeM+30;
  if(working && breakfastM > timeToMin(dayCfg.workStart)-dayCfg.commuteMin-10){
    breakfastM = Math.max(wakeM+15, timeToMin(dayCfg.workStart)-dayCfg.commuteMin-40);
  }
  events.push({time:minToTime(breakfastM), type:"meal", mealId:"breakfast", title:"Breakfast", why:"High-protein start to preserve muscle and fuel your morning."});

  if(working){
    events.push({time:dayCfg.workStart, type:"work", title:"Work begins", why:""});
  }

  // mid-morning snack
  if(data.routine.snacksPerDay >= 1){
    let snackM = working ? Math.round((timeToMin(dayCfg.workStart)+  (working? Math.min(timeToMin(dayCfg.workEnd), breakfastM+300):breakfastM+240))/2) : breakfastM+210;
    snackM = clampNum(snackM, breakfastM+90, sleepM-120);
    events.push({time:minToTime(snackM), type:"meal", mealId:"snack1", title:"Snack", why:"Keeps energy and protein intake steady between meals."});
  }

  // lunch
  let lunchM = working ? Math.round((timeToMin(dayCfg.workStart)+timeToMin(dayCfg.workEnd))/2) : Math.max(breakfastM+240, 780);
  lunchM = clampNum(lunchM, breakfastM+150, sleepM-180);
  events.push({time:minToTime(lunchM), type:"meal", mealId:"lunch", title:"Lunch", why:"Balanced protein and carbs to refuel through the rest of the day."});

  if(working){
    events.push({time:dayCfg.workEnd, type:"work", title:"Work ends", why:""});
    if(dayCfg.commuteMin>0){
      events.push({time:addMin(dayCfg.workEnd, dayCfg.commuteMin), type:"commute", title:"Home / commute complete", why:""});
    }
  }

  // workout + surrounding nutrition
  if(workoutWindow){
    const [wS, wE] = workoutWindow;
    const preM = wS-30;
    events.push({time:minToTime(preM), type:"meal", mealId:"preworkout", title:"Pre-workout snack", why:"Quick carbs to top off energy before training."});
    let workoutWhy;
    if(!working){ workoutWhy = "Scheduled in your free window today — no work to plan around."; }
    else if(wS >= timeToMin(dayCfg.workEnd)){ workoutWhy = `Scheduled after your commute so it never overlaps work, which ends at ${fmt12(dayCfg.workEnd)}.`; }
    else if(wS + (wE-wS) <= timeToMin(dayCfg.workStart)-(dayCfg.commuteMin||0)){ workoutWhy = `Scheduled before work starts at ${fmt12(dayCfg.workStart)}, since your evening is taken up by work.`; }
    else { workoutWhy = "Fit into the largest open window around your work hours today."; }
    events.push({time:minToTime(wS), type:"workout", title: (data.gym.hasGym?"Gym workout — "+workoutSplitLabel(dayName,data):"Home workout — "+workoutSplitLabel(dayName,data)), why:workoutWhy, duration: wE-wS});
    const postM = wE+10;
    events.push({time:minToTime(postM), type:"meal", mealId:"postworkout", title:"Post-workout nutrition", why:"Protein plus fast carbs within the anabolic window to kickstart recovery."});
    // dinner after post-workout
    let dinnerM = clampNum(postM+90, postM+60, sleepM-90);
    events.push({time:minToTime(dinnerM), type:"meal", mealId:"dinner", title:"Dinner", why:"Rounds out your daily protein and calorie target."});
  } else {
    // rest day — evening snack + supplements if any, dinner around 19:30 or based on schedule
    if(data.routine.snacksPerDay >= 2){
      const snack2M = clampNum(lunchM+240, lunchM+120, sleepM-240);
      events.push({time:minToTime(snack2M), type:"meal", mealId:"snack2", title:"Snack", why:"Light bridge between lunch and dinner."});
    }
    let dinnerM = clampNum(lunchM+390, lunchM+180, sleepM-90);
    events.push({time:minToTime(dinnerM), type:"meal", mealId:"dinner", title:"Dinner", why: restDay ? "Rest-day dinner focused on recovery and steady protein." : "Rounds out your daily protein and calorie target."});
  }

  // supplements
  (data.supplements||[]).forEach(s=>{
    if(!s.name) return;
    if(s.frequency==="workout-days" && !workoutToday) return;
    let sM;
    if(s.timing==="pre-workout" && workoutWindow) sM = workoutWindow[0]-25;
    else if(s.timing==="post-workout" && workoutWindow) sM = workoutWindow[1]+15;
    else if(s.timing==="evening") sM = sleepM-90;
    else sM = wakeM+40;
    events.push({time:minToTime(sM), type:"supplement", title:`${s.name}${s.dose?" — "+s.dose:""}`, why:s.notes||"As part of your supplement routine."});
  });

  // wind-down + sleep
  events.push({time:minToTime(sleepM-30), type:"sleep", title:"Wind down — screens off, prepare for sleep", why:"A consistent wind-down improves sleep quality and recovery."});
  events.push({time:minToTime(sleepM), type:"sleep", title:"Sleep", why:""});

  events.forEach(e=> e._m = timeToMin(e.time));
  events.sort((a,b)=>a._m-b._m);

  const meals = buildMealsForDay(events, data, macros, restDay);
  const workout = workoutWindow ? buildWorkoutForDay(dayName, data, workoutWindow[1]-workoutWindow[0]) : null;

  return { events, meals, workout, macros, restDay: !workoutWindow, workoutWindow };
}

function workoutSplitLabel(dayName, data){
  const idx = data.gym.preferredDays.indexOf(dayName);
  const n = data.gym.preferredDays.length;
  const splits = workoutSplitPlan(n);
  return splits[idx % splits.length] || "Full body";
}

/* ==========================================================================
   MEAL BUILDING
   ========================================================================== */
function macroShareForMealType(type){
  return { breakfast:0.22, lunch:0.30, dinner:0.28, snack1:0.08, snack2:0.07, preworkout:0.06, postworkout:0.12 }[type] || 0.1;
}
function buildMealsForDay(events, data, macros, restDay){
  const mealEvents = events.filter(e=>e.type==="meal");
  const proteinPool = likedList(data,"protein");
  const carbPool = likedList(data,"carbs");
  const vegPool = likedList(data,"veg");
  const fruitPool = likedList(data,"fruit");
  const meals = [];
  mealEvents.forEach((ev, i)=>{
    const meal = composeMeal(ev.mealId, proteinPool, carbPool, vegPool, fruitPool, data, i);
    meal.time = ev.time; meal.id = ev.mealId; meal.title = ev.title; meal.why = mealWhy(ev.mealId, restDay);
    meals.push(meal);
  });
  return meals;
}
function composeMeal(mealId, proteinPool, carbPool, vegPool, fruitPool, data, seed){
  const items = [];
  const pick = (pool, offset)=> pool.length ? pool[(seed+offset) % pool.length] : null;
  if(mealId==="preworkout"){
    const c = pick(carbPool,0) || pick(fruitPool,0);
    const fr = pick(fruitPool,1);
    if(c) items.push(c); if(fr && fr!==c) items.push(fr);
  } else if(mealId==="postworkout"){
    items.push("Protein shake");
    const c = pick(carbPool,1);
    if(c) items.push(c);
  } else if(mealId==="snack1" || mealId==="snack2"){
    const p = pick(proteinPool, mealId==="snack1"?0:1);
    const fr = pick(fruitPool, mealId==="snack1"?0:1);
    if(p) items.push(p); if(fr) items.push(fr);
  } else {
    const p = pick(proteinPool, ["breakfast","lunch","dinner"].indexOf(mealId));
    const c = pick(carbPool, ["breakfast","lunch","dinner"].indexOf(mealId));
    const v = mealId!=="breakfast" ? pick(vegPool, ["breakfast","lunch","dinner"].indexOf(mealId)) : null;
    if(p) items.push(p); if(c) items.push(c); if(v) items.push(v);
  }
  const totals = items.reduce((acc,name)=>{
    const f = FOOD_DB[name]; if(!f) return acc;
    acc.kcal += f.kcal; acc.p += f.p; acc.c += f.c; acc.f += f.f;
    return acc;
  }, {kcal:0,p:0,c:0,f:0});
  return {
    items: items.map(name=>({name, serving: FOOD_DB[name]?FOOD_DB[name].serving:name})),
    totals
  };
}
function mealWhy(mealId, restDay){
  const map = {
    breakfast: "High-protein breakfast designed to support muscle retention while providing enough carbohydrates for your morning.",
    lunch: "Balanced plate to keep energy steady and hit your protein target for the day.",
    dinner: restDay ? "Rest-day dinner focused on recovery and steady protein intake." : "Final meal of the day to round out your protein and calories after training.",
    snack1: "A light bridge to prevent energy dips and keep protein intake spread evenly.",
    snack2: "A light bridge to prevent energy dips and keep protein intake spread evenly.",
    preworkout: "Fast-digesting carbohydrate to top off glycogen before you train.",
    postworkout: "Protein and fast carbs inside the post-training window to support recovery."
  };
  return map[mealId] || "";
}
function alternativesForMeal(meal, data){
  const proteinPool = likedList(data,"protein");
  const carbPool = likedList(data,"carbs");
  const vegPool = likedList(data,"veg");
  const alts = [];
  for(let i=1;i<=3;i++){
    const alt = composeMeal(meal.id, proteinPool, carbPool, vegPool, likedList(data,"fruit"), data, (meal._seed||0)+i*2);
    alts.push(alt);
  }
  return alts;
}

/* ==========================================================================
   WORKOUT BUILDING
   ========================================================================== */
const EXERCISE_DB = {
  gym: {
    "Chest + Triceps": [
      {name:"Bench Press", muscle:"Chest", eq:"Barbell", sets:"4 × 8–10"},
      {name:"Incline Dumbbell Press", muscle:"Chest", eq:"Dumbbells", sets:"3 × 10"},
      {name:"Cable Fly", muscle:"Chest", eq:"Cable machine", sets:"3 × 12"},
      {name:"Triceps Pushdown", muscle:"Triceps", eq:"Cable machine", sets:"3 × 12"},
      {name:"Overhead Triceps Extension", muscle:"Triceps", eq:"Dumbbells", sets:"3 × 10"},
    ],
    "Back + Biceps": [
      {name:"Deadlift", muscle:"Back", eq:"Barbell", sets:"4 × 6"},
      {name:"Lat Pulldown", muscle:"Back", eq:"Lat pulldown", sets:"4 × 10"},
      {name:"Seated Cable Row", muscle:"Back", eq:"Cable machine", sets:"3 × 10"},
      {name:"Barbell Curl", muscle:"Biceps", eq:"Barbell", sets:"3 × 10"},
      {name:"Dumbbell Hammer Curl", muscle:"Biceps", eq:"Dumbbells", sets:"3 × 12"},
    ],
    "Legs": [
      {name:"Back Squat", muscle:"Quads", eq:"Squat rack", sets:"4 × 8"},
      {name:"Leg Press", muscle:"Quads", eq:"Leg press", sets:"3 × 12"},
      {name:"Romanian Deadlift", muscle:"Hamstrings", eq:"Barbell", sets:"3 × 10"},
      {name:"Walking Lunge", muscle:"Glutes", eq:"Dumbbells", sets:"3 × 12 each leg"},
      {name:"Standing Calf Raise", muscle:"Calves", eq:"Machines", sets:"4 × 15"},
    ],
    "Shoulders + Core": [
      {name:"Overhead Press", muscle:"Shoulders", eq:"Barbell", sets:"4 × 8"},
      {name:"Lateral Raise", muscle:"Shoulders", eq:"Dumbbells", sets:"3 × 15"},
      {name:"Face Pull", muscle:"Rear delts", eq:"Cable machine", sets:"3 × 15"},
      {name:"Hanging Leg Raise", muscle:"Core", eq:"Other", sets:"3 × 12"},
      {name:"Plank", muscle:"Core", eq:"Other", sets:"3 × 45s"},
    ],
    "Full Body": [
      {name:"Goblet Squat", muscle:"Legs", eq:"Dumbbells", sets:"3 × 12"},
      {name:"Dumbbell Bench Press", muscle:"Chest", eq:"Dumbbells", sets:"3 × 10"},
      {name:"Bent-over Row", muscle:"Back", eq:"Barbell", sets:"3 × 10"},
      {name:"Overhead Press", muscle:"Shoulders", eq:"Barbell", sets:"3 × 10"},
      {name:"Plank", muscle:"Core", eq:"Other", sets:"3 × 45s"},
    ]
  },
  home: {
    "Upper Body": [
      {name:"Push-ups", muscle:"Chest", eq:"None", sets:"4 × 10–15"},
      {name:"Pike Push-ups", muscle:"Shoulders", eq:"None", sets:"3 × 10"},
      {name:"Dumbbell Row", muscle:"Back", eq:"Dumbbells", sets:"3 × 12"},
      {name:"Resistance Band Curl", muscle:"Biceps", eq:"Resistance bands", sets:"3 × 15"},
      {name:"Bench Dips", muscle:"Triceps", eq:"Bench", sets:"3 × 12"},
    ],
    "Lower Body": [
      {name:"Bodyweight Squats", muscle:"Quads", eq:"None", sets:"4 × 15"},
      {name:"Lunges", muscle:"Glutes", eq:"None", sets:"3 × 12 each leg"},
      {name:"Glute Bridge", muscle:"Glutes", eq:"None", sets:"3 × 15"},
      {name:"Calf Raise", muscle:"Calves", eq:"None", sets:"4 × 20"},
      {name:"Wall Sit", muscle:"Quads", eq:"None", sets:"3 × 40s"},
    ],
    "Full Body": [
      {name:"Push-ups", muscle:"Chest", eq:"None", sets:"3 × 12"},
      {name:"Bodyweight Squats", muscle:"Legs", eq:"None", sets:"3 × 15"},
      {name:"Pull-ups", muscle:"Back", eq:"Pull-up bar", sets:"3 × max"},
      {name:"Plank", muscle:"Core", eq:"None", sets:"3 × 45s"},
      {name:"Mountain Climbers", muscle:"Core", eq:"None", sets:"3 × 30s"},
    ],
    "Core + Cardio": [
      {name:"Plank", muscle:"Core", eq:"None", sets:"3 × 45s"},
      {name:"Bicycle Crunches", muscle:"Core", eq:"None", sets:"3 × 20"},
      {name:"Jumping Jacks", muscle:"Cardio", eq:"None", sets:"4 × 30s"},
      {name:"High Knees", muscle:"Cardio", eq:"None", sets:"4 × 30s"},
      {name:"Burpees", muscle:"Full body", eq:"None", sets:"3 × 10"},
    ]
  }
};
function workoutSplitPlan(n){
  if(n<=1) return ["Full Body"];
  if(n===2) return ["Upper Body","Lower Body"];
  if(n===3) return ["Full Body","Full Body","Full Body"];
  if(n===4) return ["Chest + Triceps","Back + Biceps","Legs","Shoulders + Core"];
  return ["Chest + Triceps","Back + Biceps","Legs","Shoulders + Core","Full Body","Core + Cardio"];
}
function buildWorkoutForDay(dayName, data, durationMin){
  const hasGym = data.gym.hasGym;
  const idx = data.gym.preferredDays.indexOf(dayName);
  const n = data.gym.preferredDays.length;
  let splitNames = hasGym ? workoutSplitPlan(n) : (n<=1?["Full Body"]:n===2?["Upper Body","Lower Body"]:["Upper Body","Lower Body","Full Body","Core + Cardio"]);
  const label = splitNames[idx % splitNames.length];
  const db = hasGym ? EXERCISE_DB.gym : EXERCISE_DB.home;
  let exercises = db[label] || db[Object.keys(db)[0]];
  const equipment = hasGym ? data.gym.equipment : data.gym.homeEquipment;
  if(equipment && equipment.length){
    const filtered = exercises.filter(ex=> ex.eq==="None" || equipment.includes(ex.eq) || equipment.includes("Other"));
    if(filtered.length>=3) exercises = filtered;
  }
  const experience = data.profile.experience;
  const restSec = experience==="beginner"?90:experience==="intermediate"?75:60;
  return {
    label,
    duration: durationMin,
    exercises: exercises.map(e=>({...e, rest: restSec+"s rest"}))
  };
}

/* ==========================================================================
   PLAN GENERATION (with loading animation)
   ========================================================================== */
const GEN_LINES = ["Analyzing your schedule…","Calculating your nutrition targets…","Planning your workouts…","Synchronizing meals with your work schedule…","Building your week…","Your MuscleSync plan is ready!"];
function generateWeeklyPlan(weekKey, cb){
  const overlay = document.getElementById("genOverlay");
  const lineEl = document.getElementById("genLine");
  const fillEl = document.getElementById("genProgressFill");
  overlay.classList.remove("hidden");
  let i = 0;
  fillEl.style.width = "0%";
  const step = ()=>{
    lineEl.textContent = GEN_LINES[i];
    fillEl.style.width = Math.round(((i+1)/GEN_LINES.length)*100)+"%";
    i++;
    if(i < GEN_LINES.length){ setTimeout(step, 420); }
    else {
      setTimeout(()=>{
        const week = App.data.weeks[weekKey] || defaultWeekSchedule(App.data);
        App.data.weeks[weekKey] = week;
        const days = {};
        DAY_NAMES.forEach(day=>{ days[day] = generateDayPlan(day, week.days[day], weekKey, App.data); });
        App.data.plans[weekKey] = { days, generatedAt: Date.now() };
        App.save();
        overlay.classList.add("hidden");
        if(cb) cb();
      }, 500);
    }
  };
  step();
}

/* ==========================================================================
   RENDER: HOME
   ========================================================================== */
function currentWeekKey(){ return weekKeyFor(0); }
function ensurePlanForWeek(weekKey){ return App.data.plans[weekKey]; }

function renderHome(){
  const wk = currentWeekKey();
  const plan = ensurePlanForWeek(wk);
  const host = document.getElementById("homeContent");
  const name = App.data.profile.name ? App.data.profile.name.split(" ")[0] : App.user;

  if(!plan){
    host.innerHTML = `
      <div class="hero-card">
        <div class="hero-date">${new Date().toLocaleDateString(undefined,{weekday:"long", month:"long", day:"numeric"})}</div>
        <div class="hero-headline">Welcome, ${esc(name)}. Let's build your first week.</div>
      </div>
      <div class="empty-state">
        <div class="es-icon">📋</div>
        <h3>No weekly plan yet</h3>
        <p>MuscleSync will sync your meals, workouts and supplements around your real schedule.</p>
        <button class="btn btn-primary" id="createPlanBtn">Create My Plan</button>
      </div>`;
    document.getElementById("createPlanBtn").addEventListener("click", ()=> generateWeeklyPlan(wk, ()=> renderHome()));
    return;
  }

  const today = todayDayName();
  const dayPlan = plan.days[today];
  const macros = dayPlan.macros;
  const checklist = getChecklistForDate(isoDate(new Date()));
  const items = checklistItemsFor(dayPlan);
  const doneCount = items.filter(it=>checklist[it.key]).length;
  const pct = items.length ? Math.round(doneCount/items.length*100) : 0;

  const nextEvent = findNextEvent(dayPlan);

  host.innerHTML = `
    <div class="hero-card">
      <div class="hero-date">${new Date().toLocaleDateString(undefined,{weekday:"long", month:"long", day:"numeric"})}</div>
      <div class="hero-headline">${dayPlan.restDay ? "Rest day — recover well." : "Today's focus: "+ (dayPlan.workout? dayPlan.workout.label : "Training day")}</div>
    </div>

    ${nextEvent ? `
    <div class="card">
      <div class="card-title-row"><h3>Next up</h3></div>
      <div style="display:flex; align-items:center; gap:12px;">
        <div style="font-size:26px;">${iconForEvent(nextEvent)}</div>
        <div style="flex:1;">
          <div style="font-weight:800; font-size:15px;">${esc(nextEvent.title)}</div>
          <div class="muted" style="font-size:13px;">${fmt12(nextEvent.time)}${nextEvent.duration?` · ${nextEvent.duration} min`:""}</div>
        </div>
      </div>
    </div>` : ""}

    <div class="stat-grid" style="margin-bottom:14px;">
      ${statBox("🔥", macros.calories+" kcal", "Calories", 100, "var(--accent)")}
      ${statBox("💪", macros.protein+"g", "Protein", 100, "var(--protein)")}
      ${statBox("🍚", macros.carbs+"g", "Carbs", 100, "var(--carbs)")}
      ${statBox("💧", macros.water+"L", "Water", 100, "var(--water)")}
    </div>

    <div class="card">
      <div class="card-title-row"><h3>Today's progress</h3><span class="muted" style="font-size:13px;">${doneCount} / ${items.length} completed</span></div>
      <div class="stat-box" style="padding:0; background:transparent; border:none;">
        <div class="stat-bar" style="height:8px;"><div class="stat-bar-fill" style="width:${pct}%; background:var(--accent);"></div></div>
      </div>
      <div class="checklist" style="margin-top:14px;">
        ${items.map(it=>`
          <div class="check-row ${checklist[it.key]?"done":""}" data-key="${it.key}">
            <div class="check-box">${checklist[it.key]?"✓":""}</div>
            <div class="check-label">${esc(it.label)}</div>
            <div class="check-time">${it.time?fmt12(it.time):""}</div>
          </div>`).join("")}
      </div>
    </div>

    <div class="card">
      <div class="card-title-row"><h3>Today's timeline</h3><button class="link" id="viewWeekLink">View week →</button></div>
      ${renderTimeline(dayPlan.events)}
    </div>
  `;

  host.querySelectorAll(".check-row").forEach(row=>{
    row.addEventListener("click", ()=>{
      toggleChecklist(isoDate(new Date()), row.dataset.key);
      renderHome();
    });
  });
  const viewWeekLink = document.getElementById("viewWeekLink");
  if(viewWeekLink) viewWeekLink.addEventListener("click", ()=> goToPage("week"));
}
function statBox(icon,value,label,pct,color){
  return `<div class="stat-box"><div class="stat-icon">${icon}</div><div class="stat-value">${value}</div><div class="stat-label">${label}</div></div>`;
}
function iconForEvent(ev){
  return {wake:"⏰",water:"💧",meal:"🍽️",work:"💼",commute:"🚗",workout:"🏋️",supplement:"💊",sleep:"😴"}[ev.type] || "•";
}
function findNextEvent(dayPlan){
  const nowM = new Date().getHours()*60 + new Date().getMinutes();
  const upcoming = dayPlan.events.filter(e=> timeToMin(e.time) >= nowM && e.type!=="work");
  return upcoming[0] || dayPlan.events[0];
}
function renderTimeline(events){
  return `<div class="timeline">
    ${events.map(ev=>`
      <div class="tl-item tl-${ev.type==="workout"?"workout":ev.type==="sleep"?"sleep":ev.type==="work"||ev.type==="commute"?"work":""}">
        <div class="tl-dot"></div>
        <div class="tl-time">${fmt12(ev.time)}</div>
        <div class="tl-title">${iconForEvent(ev)} ${esc(ev.title)}</div>
        ${ev.why?`<div class="tl-why">${esc(ev.why)}</div>`:""}
      </div>`).join("")}
  </div>`;
}
function checklistItemsFor(dayPlan){
  const items = [];
  dayPlan.meals.forEach(m=> items.push({key:"meal_"+m.id, label:m.title, time:m.time}));
  if(dayPlan.workout) items.push({key:"workout", label:"Workout — "+dayPlan.workout.label, time: dayPlan.workoutWindow?minToTime(dayPlan.workoutWindow[0]):null});
  (App.data.supplements||[]).forEach(s=>{ if(s.name) items.push({key:"supp_"+s.id, label:s.name, time:null}); });
  items.push({key:"water", label:"Water goal — "+App.data.routine.waterGoalL+"L", time:null});
  items.push({key:"sleep", label:"Sleep goal", time:null});
  return items;
}
function getChecklistForDate(dateStr){
  if(!App.data.checklist[dateStr]) App.data.checklist[dateStr] = {};
  return App.data.checklist[dateStr];
}
function toggleChecklist(dateStr, key){
  const c = getChecklistForDate(dateStr);
  c[key] = !c[key];
  App.save();
}

/* ==========================================================================
   RENDER: MY WEEK
   ========================================================================== */
function renderWeek(){
  const host = document.getElementById("weekContent");
  const offsets = [-1,0,1];
  const labels = ["Previous week","Current week","Next week"];
  if(App.currentWeekOffset===undefined) App.currentWeekOffset = 0;
  const wk = weekKeyFor(App.currentWeekOffset);
  if(!App.data.weeks[wk]) App.data.weeks[wk] = defaultWeekSchedule(App.data);
  const plan = App.data.plans[wk];

  host.innerHTML = `
    <div class="week-tabs">
      ${offsets.map((o,i)=>`<div class="week-tab ${App.currentWeekOffset===o?"active":""}" data-off="${o}">${labels[i]}</div>`).join("")}
    </div>
    <div class="card">
      <div class="card-title-row">
        <h3>Week of ${weekLabel(wk)}</h3>
        <button class="link" id="dupPrevBtn">Duplicate previous week</button>
      </div>
      <div id="weekEditorHost"></div>
      <div style="display:flex; gap:10px; margin-top:14px;">
        <button class="btn btn-primary btn-block" id="saveScheduleBtn">Save & Regenerate Plan</button>
      </div>
    </div>
    ${plan ? `<div class="card"><div class="card-title-row"><h3>This week's plan</h3></div>${renderWeekPlanSummary(plan)}</div>` : `
    <div class="empty-state"><div class="es-icon">🗓️</div><h3>No plan generated for this week</h3><p>Save your schedule to generate a synced plan.</p></div>`}
  `;
  renderWeekEditorInto(document.getElementById("weekEditorHost"), App.data.weeks[wk], false);

  host.querySelectorAll(".week-tab").forEach(tab=>{
    tab.addEventListener("click", ()=>{ App.currentWeekOffset = +tab.dataset.off; renderWeek(); });
  });
  document.getElementById("saveScheduleBtn").addEventListener("click", ()=>{
    collectWeekEditor(App.data.weeks[wk]);
    App.save();
    generateWeeklyPlan(wk, ()=>{ toast("Week regenerated.", "success"); renderWeek(); if(App.currentPage==="home") renderHome(); });
  });
  document.getElementById("dupPrevBtn").addEventListener("click", ()=>{
    const prevKey = weekKeyFor(App.currentWeekOffset-1);
    const prevWeek = App.data.weeks[prevKey];
    if(!prevWeek){ toast("No previous week saved yet.", "error"); return; }
    App.data.weeks[wk] = JSON.parse(JSON.stringify(prevWeek));
    App.save();
    renderWeek();
    toast("Previous week duplicated.", "success");
  });
}
function renderWeekPlanSummary(plan){
  return `<div class="day-pill-row">
    ${DAY_NAMES.map(day=>{
      const dp = plan.days[day];
      return `<div class="day-pill ${dp.restDay?"off":""}">
        <div class="dp-name">${DAY_SHORT[day]}</div>
        <div class="dp-sub">${dp.restDay?"Rest":"Train"}</div>
      </div>`;
    }).join("")}
  </div>
  <div class="checklist">
    ${DAY_NAMES.map(day=>{
      const dp = plan.days[day];
      return `<div class="list-row"><div class="list-row-label">${day}</div><div class="list-row-value">${dp.restDay?"Rest day":dp.workout.label} · ${dp.macros.calories} kcal</div></div>`;
    }).join("")}
  </div>`;
}

/* ==========================================================================
   RENDER: WORKOUT
   ========================================================================== */
function renderWorkout(){
  const host = document.getElementById("workoutContent");
  const wk = currentWeekKey();
  const plan = App.data.plans[wk];
  if(!plan){
    host.innerHTML = emptyStateHTML("🏋️","No workout plan yet","Generate your weekly plan first from Home or My Week.");
    return;
  }
  if(!App.currentWorkoutDay) App.currentWorkoutDay = todayDayName();
  const day = App.currentWorkoutDay;
  const dp = plan.days[day];

  host.innerHTML = `
    <div class="day-pill-row" id="workoutDayPills">
      ${DAY_NAMES.map(d=>{
        const dpp = plan.days[d];
        return `<div class="day-pill ${d===day?"active":""} ${dpp.restDay?"off":""}" data-day="${d}">
          <div class="dp-name">${DAY_SHORT[d]}</div>
          <div class="dp-sub">${dpp.restDay?"Rest":"Train"}</div>
        </div>`;
      }).join("")}
    </div>
    ${dp.restDay ? `
      <div class="card">
        <div class="card-title-row"><h3>Rest day</h3><span class="tag accent">Recovery</span></div>
        <ul style="margin:0; padding-left:18px; color:var(--text-dim); font-size:14px; line-height:2;">
          <li>Light walking, 20–30 minutes</li>
          <li>Mobility & stretching</li>
          <li>Hydration — ${dp.macros.water}L target</li>
          <li>Nutrition — ${dp.macros.calories} kcal, ${dp.macros.protein}g protein</li>
          <li>Sleep target — aim for a full night</li>
        </ul>
      </div>` : `
      <div class="card">
        <div class="card-title-row">
          <h3>${esc(dp.workout.label)}</h3>
          <span class="tag accent">${dp.workout.duration} min</span>
        </div>
        <p class="muted" style="font-size:13px; margin-bottom:6px;">${App.data.gym.hasGym?"Gym session":"Home session"} · ${App.data.profile.experience}</p>
        ${dp.workout.exercises.map(ex=>`
          <div class="exercise-row">
            <div>
              <div class="exercise-name">${esc(ex.name)}</div>
              <div class="exercise-meta">${esc(ex.muscle)} · ${esc(ex.eq)} · ${ex.rest}</div>
            </div>
            <div class="exercise-sets">${ex.sets}</div>
          </div>`).join("")}
      </div>
    `}
    <div class="card">
      <div class="card-title-row"><h3>Why this timing?</h3></div>
      <p class="muted" style="font-size:13.5px; line-height:1.6;">
        ${dp.restDay ? `${day} is a scheduled recovery day based on your preferred training days — your muscles rebuild while you rest.` :
        `Your workout is scheduled at ${fmt12(minToTime(dp.workoutWindow[0]))} because that's the best window around your work hours, commute, and sleep for ${day}.`}
      </p>
    </div>
  `;
  host.querySelectorAll("#workoutDayPills .day-pill").forEach(p=>{
    p.addEventListener("click", ()=>{ App.currentWorkoutDay = p.dataset.day; renderWorkout(); });
  });
}
function emptyStateHTML(icon,title,body){
  return `<div class="empty-state"><div class="es-icon">${icon}</div><h3>${title}</h3><p>${body}</p></div>`;
}

/* ==========================================================================
   RENDER: NUTRITION
   ========================================================================== */
function renderNutrition(){
  const host = document.getElementById("nutritionContent");
  const wk = currentWeekKey();
  const plan = App.data.plans[wk];
  if(!plan){
    host.innerHTML = emptyStateHTML("🍽️","No nutrition plan yet","Generate your weekly plan first from Home or My Week.");
    return;
  }
  if(!App.currentNutritionDay) App.currentNutritionDay = todayDayName();
  const day = App.currentNutritionDay;
  const dp = plan.days[day];
  const m = dp.macros;

  host.innerHTML = `
    <div class="day-pill-row" id="nutDayPills">
      ${DAY_NAMES.map(d=>`<div class="day-pill ${d===day?"active":""}" data-day="${d}"><div class="dp-name">${DAY_SHORT[d]}</div></div>`).join("")}
    </div>

    <div class="card">
      <div class="card-title-row"><h3>Daily targets</h3><span class="muted" style="font-size:12px;">Estimates, not medical advice</span></div>
      <div class="stat-grid">
        ${statBox("🔥", m.calories+" kcal","Calories")}
        ${statBox("💪", m.protein+"g","Protein")}
        ${statBox("🍚", m.carbs+"g","Carbs")}
        ${statBox("🥑", m.fat+"g","Fat")}
      </div>
    </div>

    <div class="card-title-row" style="margin-top:4px;"><h3 class="section-title" style="margin:0;">Meals</h3></div>
    ${dp.meals.map((meal,i)=>`
      <div class="meal-card">
        <div class="meal-head">
          <div>
            <div class="meal-name">${esc(meal.title)}</div>
          </div>
          <div class="meal-time">${fmt12(meal.time)}</div>
        </div>
        <div class="meal-items">${meal.items.map(it=>`${esc(it.name)} — ${esc(it.serving)}`).join("<br>")}</div>
        <div class="macro-pills">
          <span class="macro-pill">${meal.totals.kcal} kcal</span>
          <span class="macro-pill">P ${meal.totals.p}g</span>
          <span class="macro-pill">C ${meal.totals.c}g</span>
          <span class="macro-pill">F ${meal.totals.f}g</span>
        </div>
        <div class="meal-why">${esc(meal.why)}</div>
        <div class="meal-actions">
          <button class="btn btn-ghost btn-sm" data-replace="${i}">Replace meal</button>
        </div>
      </div>`).join("")}

    <div class="card">
      <div class="card-title-row"><h3>Shopping list</h3><span class="muted" style="font-size:12px;">This week</span></div>
      ${renderShoppingList(plan)}
    </div>

    <div class="card">
      <div class="card-title-row"><h3>Meal prep</h3></div>
      ${renderMealPrep(plan)}
    </div>
  `;
  host.querySelectorAll("#nutDayPills .day-pill").forEach(p=>{
    p.addEventListener("click", ()=>{ App.currentNutritionDay = p.dataset.day; renderNutrition(); });
  });
  host.querySelectorAll("[data-replace]").forEach(btn=>{
    btn.addEventListener("click", ()=> openReplaceMealModal(day, +btn.dataset.replace));
  });
  host.querySelectorAll("[data-shop]").forEach(cb=>{
    cb.addEventListener("change", ()=>{
      App.data.shoppingChecks[cb.dataset.shop] = cb.checked;
      App.save();
    });
  });
}
function openReplaceMealModal(day, mealIndex){
  const wk = currentWeekKey();
  const dp = App.data.plans[wk].days[day];
  const meal = dp.meals[mealIndex];
  const alts = alternativesForMeal({...meal, _seed: mealIndex}, App.data);
  openModal(`
    <h3>Replace ${esc(meal.title)}</h3>
    ${alts.map((alt,i)=>`
      <div class="option-card" data-alt="${i}">
        <h4>${alt.items.map(it=>it.name).join(" + ") || "Alternative"}</h4>
        <p>${alt.totals.kcal} kcal · P ${alt.totals.p}g · C ${alt.totals.c}g · F ${alt.totals.f}g</p>
      </div>`).join("")}
  `);
  document.querySelectorAll("#modalInner .option-card").forEach(card=>{
    card.addEventListener("click", ()=>{
      const alt = alts[+card.dataset.alt];
      dp.meals[mealIndex] = {...meal, items: alt.items, totals: alt.totals};
      App.save();
      closeModal();
      renderNutrition();
      toast("Meal replaced.", "success");
    });
  });
}
function renderShoppingList(plan){
  const cats = {protein:[], carbs:[], veg:[], fruit:[], other:[]};
  const seen = new Set();
  Object.values(plan.days).forEach(dp=>{
    dp.meals.forEach(m=> m.items.forEach(it=>{
      if(seen.has(it.name)) return; seen.add(it.name);
      const f = FOOD_DB[it.name];
      const tag = f ? (f.tags.find(t=>["protein","carbs","veg","fruit"].includes(t)) || "other") : "other";
      cats[tag].push(it.name);
    }));
  });
  const labels = {protein:"Protein", carbs:"Carbohydrates", veg:"Vegetables", fruit:"Fruits", other:"Other"};
  return Object.entries(cats).filter(([k,v])=>v.length).map(([cat,list])=>`
    <div class="shop-cat">
      <h4>${labels[cat]}</h4>
      ${list.map(name=>{
        const key = "wk_"+cat+"_"+name;
        const checked = App.data.shoppingChecks[key];
        return `<label class="list-row clickable" style="cursor:pointer;">
          <span class="list-row-label" style="${checked?"text-decoration:line-through; color:var(--text-faint);":""}">${esc(name)}</span>
          <input type="checkbox" data-shop="${key}" ${checked?"checked":""} style="width:20px;height:20px;">
        </label>`;
      }).join("")}
    </div>`).join("");
}
function renderMealPrep(plan){
  const chicken = plan.days.Monday.meals.some(m=>m.items.some(i=>i.name==="Chicken"));
  return `<ul style="margin:0; padding-left:18px; color:var(--text-dim); font-size:13.5px; line-height:2;">
    <li>Batch-cook your main protein sources for 3–4 days at a time</li>
    <li>Cook a large batch of rice, potatoes or quinoa and portion into containers</li>
    <li>Wash and chop vegetables in advance for quick assembly</li>
    <li>Prepare grab-and-go breakfast and snack portions the night before work</li>
    <li>Keep max prep time under ${App.data.routine.maxPrepMin} minutes per session, per your preference</li>
  </ul>`;
}

/* ==========================================================================
   RENDER: PROGRESS
   ========================================================================== */
function renderProgress(){
  const host = document.getElementById("progressContent");
  const log = App.data.progress || [];
  const sorted = [...log].sort((a,b)=> new Date(a.date)-new Date(b.date));
  const latest = sorted[sorted.length-1];
  const first = sorted[0];
  const change = latest && first ? round(latest.weight-first.weight,1) : null;

  host.innerHTML = `
    <div class="card">
      <div class="card-title-row"><h3>Weight trend</h3><button class="btn btn-primary btn-sm" id="addWeightBtn">+ Log weight</button></div>
      ${sorted.length ? `<div class="chart-wrap" id="weightChart"></div>` : `<p class="muted" style="font-size:13.5px;">No entries yet. Log your first weight to start tracking.</p>`}
      ${sorted.length>=2 ? `<p class="muted" style="font-size:13px; margin-top:10px;">${change<=0?"Down":"Up"} ${Math.abs(change)} kg since your first log (${sorted.length} entries).</p>`:""}
    </div>

    <div class="card">
      <div class="card-title-row"><h3>Log history</h3></div>
      ${sorted.length ? sorted.slice().reverse().map(e=>`
        <div class="list-row"><div class="list-row-label">${new Date(e.date).toLocaleDateString(undefined,{month:"short",day:"numeric"})}</div>
        <div class="list-row-value">${e.weight} kg${e.waist?" · waist "+e.waist+"cm":""}${e.bodyFat?" · "+e.bodyFat+"% BF":""}</div></div>`).join("")
      : `<p class="muted" style="font-size:13.5px;">Nothing logged yet.</p>`}
    </div>

    ${renderWeeklyReview()}
  `;
  document.getElementById("addWeightBtn").addEventListener("click", openLogWeightModal);
  if(sorted.length) drawWeightChart(sorted);
}
function openLogWeightModal(){
  openModal(`
    <h3>Log today's measurements</h3>
    <label class="field"><span>Weight (kg)</span><input id="pw_weight" type="number" step="0.1" min="30" max="300" value="${App.data.profile.weight_kg||""}"></label>
    <label class="field"><span>Waist (cm, optional)</span><input id="pw_waist" type="number" min="40" max="200"></label>
    <label class="field"><span>Body fat % (optional)</span><input id="pw_bf" type="number" min="3" max="60"></label>
    <button class="btn btn-primary btn-block" id="saveWeightBtn">Save entry</button>
  `);
  document.getElementById("saveWeightBtn").addEventListener("click", ()=>{
    const weight = +document.getElementById("pw_weight").value;
    if(!weight || weight<30 || weight>300){ toast("Enter a realistic weight.","error"); return; }
    const waist = document.getElementById("pw_waist").value ? +document.getElementById("pw_waist").value : null;
    const bf = document.getElementById("pw_bf").value ? +document.getElementById("pw_bf").value : null;
    App.data.progress.push({date: new Date().toISOString(), weight, waist, bodyFat: bf});
    App.data.profile.weight_kg = weight;
    App.save();
    closeModal();
    toast("Progress logged.", "success");
    renderProgress();
  });
}
function drawWeightChart(sorted){
  const el = document.getElementById("weightChart");
  const w = Math.min(el.clientWidth || 320, 560), h = 140, pad = 24;
  const weights = sorted.map(e=>e.weight);
  const min = Math.min(...weights)-0.5, max = Math.max(...weights)+0.5;
  const pts = sorted.map((e,i)=>{
    const x = pad + (i/(Math.max(sorted.length-1,1)))*(w-pad*2);
    const y = h-pad - ((e.weight-min)/(max-min||1))*(h-pad*2);
    return [x,y];
  });
  const path = pts.map((p,i)=> (i===0?"M":"L")+p[0].toFixed(1)+","+p[1].toFixed(1)).join(" ");
  el.innerHTML = `<svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}" preserveAspectRatio="none">
    <path d="${path}" fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
    ${pts.map(p=>`<circle cx="${p[0]}" cy="${p[1]}" r="3.5" fill="var(--accent)"/>`).join("")}
  </svg>`;
}
function renderWeeklyReview(){
  const wk = currentWeekKey();
  const plan = App.data.plans[wk];
  if(!plan) return "";
  const log = (App.data.progress||[]).filter(e=> e.date >= wk);
  const weightChange = log.length>=2 ? round(log[log.length-1].weight - log[0].weight,1) : null;
  const workoutsPlanned = Object.values(plan.days).filter(d=>!d.restDay).length;
  const dateKeys = DAY_NAMES.map(d=> dateForDayInWeek(wk,d));
  let doneItems=0, totalItems=0;
  dateKeys.forEach((dk,i)=>{
    const dp = plan.days[DAY_NAMES[i]];
    const items = checklistItemsFor(dp);
    const c = App.data.checklist[dk] || {};
    totalItems += items.length;
    doneItems += items.filter(it=>c[it.key]).length;
  });
  const adherence = totalItems ? Math.round(doneItems/totalItems*100) : 0;
  return `
    <div class="card">
      <div class="card-title-row"><h3>Weekly report</h3></div>
      <div class="list-row"><div class="list-row-label">Weight change</div><div class="list-row-value">${weightChange!==null ? (weightChange<=0?"":"+")+weightChange+" kg" : "Log 2+ entries to see"}</div></div>
      <div class="list-row"><div class="list-row-label">Workouts planned</div><div class="list-row-value">${workoutsPlanned} / ${workoutsPlanned}</div></div>
      <div class="list-row"><div class="list-row-label">Plan adherence</div><div class="list-row-value">${adherence}%</div></div>
      <p class="muted" style="font-size:13px; margin-top:10px;">${adherence>=70?"Strong week — keep this consistency going.":"Every checked box compounds. Small consistent steps beat perfect weeks."}</p>
    </div>`;
}

/* ==========================================================================
   RENDER: PROFILE
   ========================================================================== */
function renderProfile(){
  const host = document.getElementById("profileContent");
  const p = App.data.profile, g = App.data.goal;
  host.innerHTML = `
    <div class="card">
      <div class="card-title-row"><h3>${esc(p.name)}</h3><span class="tag accent">${p.experience}</span></div>
      <div class="list-row"><div class="list-row-label">Age</div><div class="list-row-value">${p.age}</div></div>
      <div class="list-row"><div class="list-row-label">Height</div><div class="list-row-value">${p.height_cm} cm</div></div>
      <div class="list-row"><div class="list-row-label">Current weight</div><div class="list-row-value">${p.weight_kg} kg</div></div>
      <div class="list-row"><div class="list-row-label">Target weight</div><div class="list-row-value">${p.targetWeight_kg} kg</div></div>
      <button class="btn btn-ghost btn-block" style="margin-top:12px;" id="editPersonalBtn">Edit personal info</button>
    </div>

    <div class="card">
      <div class="card-title-row"><h3>Goal</h3></div>
      <div class="list-row"><div class="list-row-label">Type</div><div class="list-row-value">${goalLabel(g.type)}</div></div>
      ${g.type==="recomp"?`<div class="list-row"><div class="list-row-label">Target rate</div><div class="list-row-value">${g.rateKgPerWeek} kg/week</div></div>`:""}
      <button class="btn btn-ghost btn-block" style="margin-top:12px;" id="editGoalBtn">Change goal</button>
    </div>

    <div class="card">
      <div class="card-title-row"><h3>Gym & equipment</h3></div>
      <div class="list-row"><div class="list-row-label">Access</div><div class="list-row-value">${App.data.gym.hasGym ? (App.data.gym.name||"Gym") : "Home workouts"}</div></div>
      <div class="list-row"><div class="list-row-label">Training days</div><div class="list-row-value">${App.data.gym.preferredDays.map(d=>DAY_SHORT[d]).join(", ")}</div></div>
      <button class="btn btn-ghost btn-block" style="margin-top:12px;" id="editGymBtn">Edit gym setup</button>
    </div>

    <div class="card">
      <div class="card-title-row"><h3>Food preferences</h3></div>
      <div class="list-row"><div class="list-row-label">Restrictions</div><div class="list-row-value">${App.data.foods.restrictions.join(", ")||"None"}</div></div>
      <div class="list-row"><div class="list-row-label">Dislikes</div><div class="list-row-value">${App.data.foods.dislikes.join(", ")||"None"}</div></div>
      <button class="btn btn-ghost btn-block" style="margin-top:12px;" id="editFoodBtn">Edit food preferences</button>
    </div>

    <div class="card">
      <div class="card-title-row"><h3>Supplements</h3></div>
      ${App.data.supplements.length ? App.data.supplements.map(s=>`<div class="list-row"><div class="list-row-label">${esc(s.name)}</div><div class="list-row-value">${esc(s.dose)}</div></div>`).join("") : `<p class="muted" style="font-size:13.5px;">None added.</p>`}
      <button class="btn btn-ghost btn-block" style="margin-top:12px;" id="editSuppBtn">Edit supplements</button>
    </div>

    <div class="card">
      <div class="card-title-row"><h3>Regenerate</h3></div>
      <p class="muted" style="font-size:13px; margin-bottom:12px;">Changed something? Rebuild this week's plan without losing your profile.</p>
      <button class="btn btn-primary btn-block" id="regenBtn">Regenerate current week</button>
    </div>

    ${isAdminUser() ? `<div class="card"><div class="card-title-row"><h3>Admin</h3></div><button class="btn btn-ghost btn-block" id="goAdminBtn">Open admin dashboard</button></div>`:""}

    <div class="card">
      <button class="btn btn-danger btn-block" id="profileLogoutBtn">Log out</button>
    </div>
  `;
  document.getElementById("editPersonalBtn").addEventListener("click", ()=>openEditPersonalModal());
  document.getElementById("editGoalBtn").addEventListener("click", ()=>openEditGoalModal());
  document.getElementById("editGymBtn").addEventListener("click", ()=>openEditGymModal());
  document.getElementById("editFoodBtn").addEventListener("click", ()=>openEditFoodModal());
  document.getElementById("editSuppBtn").addEventListener("click", ()=>openEditSuppModal());
  document.getElementById("regenBtn").addEventListener("click", ()=> generateWeeklyPlan(currentWeekKey(), ()=>{ toast("Plan regenerated.","success"); renderProfile(); }));
  document.getElementById("profileLogoutBtn").addEventListener("click", ()=>{ Auth.logout(); App.user=null; App.data=null; showScreen("auth"); });
  const adminBtn = document.getElementById("goAdminBtn");
  if(adminBtn) adminBtn.addEventListener("click", ()=>{
    document.getElementById("page-admin").classList.remove("hidden");
    goToPage("admin");
  });
}
function goalLabel(t){ return {lose:"Lose weight",muscle:"Build muscle",recomp:"Build muscle + lose fat",maintain:"Maintain weight",fitness:"Improve fitness"}[t]||t; }

function openEditPersonalModal(){
  const p = App.data.profile;
  openModal(`
    <h3>Edit personal info</h3>
    <label class="field"><span>Full name</span><input id="e_name" value="${esc(p.name)}"></label>
    <div class="field-row">
      <label class="field"><span>Age</span><input id="e_age" type="number" value="${p.age}"></label>
      <label class="field"><span>Height (cm)</span><input id="e_height" type="number" value="${p.height_cm}"></label>
    </div>
    <div class="field-row">
      <label class="field"><span>Current weight (kg)</span><input id="e_weight" type="number" step="0.1" value="${p.weight_kg}"></label>
      <label class="field"><span>Target weight (kg)</span><input id="e_target" type="number" step="0.1" value="${p.targetWeight_kg}"></label>
    </div>
    <button class="btn btn-primary btn-block" id="savePersonalBtn">Save changes</button>
  `);
  document.getElementById("savePersonalBtn").addEventListener("click", ()=>{
    p.name = document.getElementById("e_name").value.trim() || p.name;
    p.age = +document.getElementById("e_age").value || p.age;
    p.height_cm = +document.getElementById("e_height").value || p.height_cm;
    p.weight_kg = +document.getElementById("e_weight").value || p.weight_kg;
    p.targetWeight_kg = +document.getElementById("e_target").value || p.targetWeight_kg;
    App.save(); closeModal(); renderProfile(); toast("Saved. Regenerate your plan to apply changes.", "success");
  });
}
function openEditGoalModal(){
  const g = App.data.goal;
  const goals = [{v:"lose",t:"Lose weight"},{v:"muscle",t:"Build muscle"},{v:"recomp",t:"Build muscle + lose fat"},{v:"maintain",t:"Maintain weight"},{v:"fitness",t:"Improve fitness"}];
  openModal(`
    <h3>Change goal</h3>
    <div class="chip-grid" id="e_goal">${goals.map(x=>`<div class="chip ${g.type===x.v?"active":""}" data-val="${x.v}">${x.t}</div>`).join("")}</div>
    <button class="btn btn-primary btn-block" style="margin-top:18px;" id="saveGoalBtn">Save & regenerate</button>
  `);
  bindToggleGroup("e_goal");
  document.getElementById("saveGoalBtn").addEventListener("click", ()=>{
    g.type = getActiveChip("e_goal") || g.type;
    App.save(); closeModal();
    generateWeeklyPlan(currentWeekKey(), ()=>{ renderProfile(); toast("Goal updated and plan regenerated.","success"); });
  });
}
function openEditGymModal(){
  const gy = App.data.gym;
  const eqOptions = ["Barbell","Dumbbells","Bench","Squat rack","Cable machine","Lat pulldown","Leg press","Smith machine","Machines","Cardio equipment","Other"];
  openModal(`
    <h3>Edit gym setup</h3>
    <div class="field"><span>Gym access</span>
      <div class="chip-grid" id="e_hasgym">
        <div class="chip ${gy.hasGym?"active":""}" data-val="yes">Yes</div>
        <div class="chip ${!gy.hasGym?"active":""}" data-val="no">No</div>
      </div>
    </div>
    <div class="field"><span>Equipment</span><div class="chip-grid" id="e_equip">${eqOptions.map(e=>`<div class="chip ${gy.equipment.includes(e)?"active":""}" data-val="${e}">${e}</div>`).join("")}</div></div>
    <div class="field"><span>Training days</span><div class="chip-grid" id="e_days">${DAY_NAMES.map(d=>`<div class="chip ${gy.preferredDays.includes(d)?"active":""}" data-val="${d}">${DAY_SHORT[d]}</div>`).join("")}</div></div>
    <label class="field"><span>Max duration (min)</span><input id="e_dur" type="number" value="${gy.maxDuration}"></label>
    <button class="btn btn-primary btn-block" id="saveGymBtn">Save & regenerate</button>
  `);
  bindToggleGroup("e_hasgym"); bindChipGroup("e_equip",true); bindChipGroup("e_days",true);
  document.getElementById("saveGymBtn").addEventListener("click", ()=>{
    gy.hasGym = getActiveChip("e_hasgym")==="yes";
    gy.equipment = getActiveChips("e_equip");
    gy.preferredDays = getActiveChips("e_days");
    gy.maxDuration = +document.getElementById("e_dur").value || gy.maxDuration;
    if(gy.preferredDays.length===0) gy.preferredDays=["Monday","Wednesday","Friday"];
    App.save(); closeModal();
    generateWeeklyPlan(currentWeekKey(), ()=>{ renderProfile(); toast("Gym setup updated and plan regenerated.","success"); });
  });
}
function openEditFoodModal(){
  const f = App.data.foods;
  const restrictions = ["Vegetarian","Vegan","Halal","Kosher","Gluten-free","Lactose intolerant"];
  openModal(`
    <h3>Edit food preferences</h3>
    <label class="field"><span>Dislikes (comma-separated)</span><input id="e_dislikes" value="${esc(f.dislikes.join(", "))}"></label>
    <div class="field"><span>Restrictions</span><div class="chip-grid" id="e_restr">${restrictions.map(r=>`<div class="chip ${f.restrictions.includes(r)?"active":""}" data-val="${r}">${r}</div>`).join("")}</div></div>
    <button class="btn btn-primary btn-block" id="saveFoodBtn">Save & regenerate</button>
  `);
  bindChipGroup("e_restr", true);
  document.getElementById("saveFoodBtn").addEventListener("click", ()=>{
    f.dislikes = document.getElementById("e_dislikes").value.split(",").map(s=>s.trim()).filter(Boolean);
    f.restrictions = getActiveChips("e_restr");
    App.save(); closeModal();
    generateWeeklyPlan(currentWeekKey(), ()=>{ renderProfile(); toast("Preferences updated and plan regenerated.","success"); });
  });
}
function openEditSuppModal(){
  openModal(`<h3>Edit supplements</h3><div id="suppList"></div><button type="button" class="btn btn-ghost btn-block" id="addSuppBtn2">+ Add supplement</button>
  <button class="btn btn-primary btn-block" style="margin-top:14px;" id="saveSuppBtn">Save & regenerate</button>`);
  renderSuppList(App.data.supplements);
  document.getElementById("addSuppBtn2").addEventListener("click", ()=>{
    App.data.supplements.push({id:uid(), name:"", dose:"", frequency:"daily", timing:"morning", notes:""});
    renderSuppList(App.data.supplements);
  });
  document.getElementById("saveSuppBtn").addEventListener("click", ()=>{
    App.save(); closeModal();
    generateWeeklyPlan(currentWeekKey(), ()=>{ renderProfile(); toast("Supplements updated and plan regenerated.","success"); });
  });
}

/* ==========================================================================
   RENDER: ADMIN
   ========================================================================== */
function renderAdmin(){
  const host = document.getElementById("adminContent");
  if(!isAdminUser()){ host.innerHTML = emptyStateHTML("🔒","Admin only","This section is restricted to the admin account."); return; }
  const db = DB.get();
  const users = Object.keys(db.users);
  const totalPlans = Object.values(db.userdata).reduce((n,u)=> n + Object.keys(u.plans||{}).length, 0);

  host.innerHTML = `
    <div class="card">
      <div class="card-title-row"><h3>Overview</h3></div>
      <div class="stat-grid">
        ${statBox("👥", users.length, "Users")}
        ${statBox("📋", totalPlans, "Plans generated")}
        ${statBox("💾", "Local", "Storage")}
        ${statBox("🧪", "Demo", "Environment")}
      </div>
      <p class="muted" style="font-size:12.5px; margin-top:12px;">This is a local, browser-only demonstration admin panel — there is no real backend or server-side user database yet.</p>
    </div>
    <div class="card">
      <div class="card-title-row"><h3>Users</h3></div>
      ${users.map(u=>{
        const ud = db.userdata[u];
        return `<div class="admin-user-row">
          <div><div style="font-weight:700; font-size:14.5px;">${esc(u)}</div><div class="muted" style="font-size:12px;">${ud.onboarded?"Onboarded":"Not onboarded"} · ${Object.keys(ud.plans||{}).length} plan(s)</div></div>
          <span class="pill-badge">${db.users[u].isAdmin?"Admin":"User"}</span>
        </div>`;
      }).join("")}
    </div>
    <div class="card">
      <div class="card-title-row"><h3>Demo data</h3></div>
      <button class="btn btn-ghost btn-block" id="loadDemoBtn" style="margin-bottom:10px;">Load demo profile for admin</button>
      <button class="btn btn-danger btn-block" id="resetDemoBtn">Reset all demo data</button>
    </div>
  `;
  document.getElementById("loadDemoBtn").addEventListener("click", ()=>{
    App.data = buildDemoProfile();
    App.save();
    toast("Demo profile loaded.", "success");
    generateWeeklyPlan(currentWeekKey(), ()=> goToPage("home"));
  });
  document.getElementById("resetDemoBtn").addEventListener("click", ()=>{
    if(!confirm("This clears all local MuscleSync data in this browser. Continue?")) return;
    localStorage.removeItem(STORAGE_KEY);
    sessionStorage.removeItem(Auth.SESSION_KEY);
    toast("Demo data reset.", "success");
    location.reload();
  });
}

function buildDemoProfile(){
  const d = DB.blankUserData();
  d.onboarded = true;
  d.profile = { name:"Alex Rivera", age:29, gender:"male", height_cm:178, weight_kg:84, targetWeight_kg:78, bodyFat:22, experience:"intermediate" };
  d.goal = { type:"recomp", rateKgPerWeek:0.35, priority:"balanced" };
  d.gym = { hasGym:true, name:"Iron Temple Fitness", equipment:["Barbell","Dumbbells","Bench","Squat rack","Cable machine","Lat pulldown"], preferredDays:["Monday","Tuesday","Thursday","Friday"], maxDuration:60, preferredTime:"evening", homeEquipment:[] };
  d.foods.likes = { protein:["Chicken","Eggs","Greek yogurt","Tuna"], carbs:["Rice","Oats","Potatoes","Bread"], veg:["Broccoli","Spinach","Tomato","Carrots"], fruit:["Banana","Berries","Apple"] };
  d.foods.dislikes = ["Mushrooms"];
  d.foods.restrictions = [];
  d.supplements = [
    {id:uid(), name:"Whey Protein", dose:"1 scoop", frequency:"workout-days", timing:"post-workout", notes:"Standard commercial serving size."},
    {id:uid(), name:"Creatine Monohydrate", dose:"5g", frequency:"daily", timing:"morning", notes:"Common maintenance dose — check with a professional for your situation."},
    {id:uid(), name:"Vitamin D3", dose:"2000 IU", frequency:"daily", timing:"morning", notes:""}
  ];
  d.routine = { wake:"06:30", bed:"22:45", mealsPerDay:3, snacksPerDay:2, waterGoalL:3, cookingAbility:"moderate", maxPrepMin:30, eatAtWork:true, fridgeAtWork:true, microwaveAtWork:true };
  const wk = weekKeyFor(0);
  d.weeks[wk] = {
    days: {
      Monday:{off:false, workStart:"08:00", workEnd:"16:00", commuteMin:20, wake:"06:30", sleep:"22:45"},
      Tuesday:{off:false, workStart:"08:00", workEnd:"16:00", commuteMin:20, wake:"06:30", sleep:"22:45"},
      Wednesday:{off:false, workStart:"08:00", workEnd:"16:00", commuteMin:20, wake:"06:30", sleep:"22:45"},
      Thursday:{off:false, workStart:"08:00", workEnd:"16:00", commuteMin:20, wake:"06:30", sleep:"22:45"},
      Friday:{off:false, workStart:"08:00", workEnd:"16:00", commuteMin:20, wake:"06:30", sleep:"22:45"},
      Saturday:{off:true, workStart:"", workEnd:"", commuteMin:0, wake:"08:00", sleep:"23:30"},
      Sunday:{off:true, workStart:"", workEnd:"", commuteMin:0, wake:"08:00", sleep:"22:30"},
    }
  };
  d.progress = [
    {date: new Date(Date.now()-21*86400000).toISOString(), weight:86.4},
    {date: new Date(Date.now()-14*86400000).toISOString(), weight:85.6},
    {date: new Date(Date.now()-7*86400000).toISOString(), weight:85.0},
    {date: new Date().toISOString(), weight:84.3},
  ];
  return d;
}

/* ==========================================================================
   BOOT
   ========================================================================== */
document.addEventListener("DOMContentLoaded", App.init);
