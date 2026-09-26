// The six months of a made-up freelancer — نیما کریمی, a UI designer and front-end developer working from home in
// Tehran — as plain data, for prisma/seedFreelancerDemo.ts to turn into database rows. Kept apart from the seeding
// logic because this is the part that is *written*: the projects he takes and finishes, the client who stops answering,
// the flu, the trip, and the notes he leaves himself on the way. It exists so that «مسیر» (src/lib/journeyEngine.ts) can
// be read against a life that has a shape, not against random rows.
//
// Every day is a number of days AGO (0 = today, 183 = the day he installed the app), so the story always ends "now"
// whenever the script is run. Days that would fall on the wrong day of the week (a client meeting on a Friday) are
// snapped to a sensible neighbour by `buildStory`, and the anchors below are shared by every item that refers to the
// same moment — the meeting, the note about it and the project's start are always on the same day.

export const WINDOW_DAYS = 183;

export interface StoryProject {
  key: string;
  name: string;
  description: string;
  color: string;
  /** Days ago the project began. */
  startAgo: number;
  /** Days ago it ended; null while it is still going. */
  endAgo: number | null;
  status: "ACTIVE" | "COMPLETED" | "ARCHIVED";
  /** How much of his tracked time it takes while it is active, relative to the others. */
  weight: number;
  /** Task titles in the order they get done. For a project still going only the first `doneCount` are finished. */
  tasks: string[];
  doneCount?: number;
  /** Titles of the work sessions he tracks against it. */
  sessions: string[];
  /** Money that comes in for it (Toman). */
  payments: Array<{ ago: number; amount: number; note: string }>;
}

export interface StoryEvent {
  ago: number;
  hour: number;
  minute?: number;
  duration: number;
  title: string;
  category: string;
  project?: string;
  place?: string;
  allDay?: boolean;
  /** Ticked as done in the calendar. Defaults to true for anything in the past. */
  attended?: boolean;
}

export interface StoryNote {
  ago: number;
  hour: number;
  text: string;
  /** Stay on this exact day (it belongs to a weekend event, the flu, the trip) instead of being moved off a Friday. */
  keepDay?: boolean;
}

export interface StoryHabit {
  key: string;
  title: string;
  icon: string;
  category: string;
  createdAgo: number;
  /** Usual clock time of the check-in. */
  hour: number;
  /** Chance it is done on a given day (ago), before the forced ranges below. */
  chance: (ago: number) => number;
  /** Ranges of days ago, inclusive, on which it is certainly done — how a long streak is made on purpose. */
  forced?: Array<[number, number]>;
  /** How often a check-in also carries a logged duration, and how long. */
  durationChance?: number;
  durationRange?: [number, number];
  /** Value credited per check-in to the "digital assets" total. */
  valuePerCheckIn: number;
}

export interface Story {
  projects: StoryProject[];
  events: StoryEvent[];
  /** A real recurrence rule in the calendar (weekly), for the meeting he never misses. */
  recurring: Array<{ title: string; category: string; weekday: number; hour: number; minute?: number; duration: number; fromAgo: number; toAgo: number | null }>;
  /** Weekly things written as separate events, so they can skip the flu and the trip. */
  weekly: Array<{ title: string; category: string; weekday: number; hour: number; minute?: number; duration: number; fromAgo: number; toAgo: number }>;
  notes: StoryNote[];
  genericNotes: string[];
  habits: StoryHabit[];
  personalTasks: string[];
  learningSessions: string[];
  adminSessions: string[];
  /** Days ago on which nothing at all is recorded (the flu). */
  sickDays: number[];
  /** Days ago spent away from the desk (the trip to Shiraz). */
  tripDays: number[];
}

/** Days ago → the weekday (0 = Sunday … 5 = Friday, 6 = Saturday) of that day. */
function weekdayOf(today: Date, ago: number): number {
  return new Date(today.getFullYear(), today.getMonth(), today.getDate() - ago).getDay();
}

/** The nearest day (preferring earlier ones) whose weekday is one of `allowed`, within three days either way. */
function snap(today: Date, ago: number, allowed: number[]): number {
  for (const delta of [0, 1, -1, 2, -2, 3, -3]) {
    const candidate = ago + delta;
    if (candidate >= 0 && candidate <= WINDOW_DAYS && allowed.includes(weekdayOf(today, candidate))) return candidate;
  }
  return ago;
}

// Iran's working week runs Saturday to Wednesday; Thursday is half a day and Friday is the weekend.
const WORKDAYS = [6, 0, 1, 2, 3];
const WEEKEND = [4, 5];

export function buildStory(today: Date): Story {
  const work = (ago: number) => snap(today, ago, WORKDAYS);
  const weekend = (ago: number) => snap(today, ago, WEEKEND);

  // --- the anchors: one moment, one day, wherever the story mentions it ---------------------------------------
  // The flu is a Sunday-to-Tuesday, the trip a Wednesday-to-Friday, so neither lands on the Saturday of his weekly meeting;
  // everything after them is placed relative to them, so no two moments of the story can collide.
  const sickStart = snap(today, 105, [0]);
  const hardTalk = work(sickStart - 5);
  const teaDelivered = work(hardTalk - 6);
  const tripStart = snap(today, teaDelivered - 4, [3]);
  const bamStart = work(tripStart - 4);

  const A = {
    install: 183,
    callRaha: work(175),
    contractRaha: work(172),
    firstDeposit: work(160),
    referral: work(152),
    teaStart: work(150),
    parvazStart: work(140),
    rahaFeedback: work(136),
    musicGhost: work(133),
    rahaDelivered: work(128),
    rezaBirthday: weekend(124),
    parvazDone: work(118),
    scopeCreep: work(112),
    fever: sickStart + 1,
    headache: sickStart + 3,
    backAtWork: sickStart - 3,
    hardTalk,
    newRule: hardTalk - 1,
    deepFocus: hardTalk - 3,
    teaDelivered,
    teaPaid: teaDelivered - 2,
    tripStart,
    bamStart,
    nayStart: work(75),
    aftabStart: work(68),
    checkup: work(60),
    momBirthday: weekend(55),
    bamDelivered: work(52),
    bamOpening: weekend(50),
    mehradStart: work(45),
    interviewOne: work(38),
    interviewTwo: work(37),
    aftabDelivered: work(30),
    blogStart: work(28),
    mehradPresent: work(21),
    accountant: work(17),
    dentistAgain: work(14),
    kamranBirthday: weekend(10),
    mehradRevisions: work(7),
    newLead: work(4),
  };

  const projects: StoryProject[] = [
    {
      key: "raha",
      name: "سایت آتلیه‌ی رها",
      description: "وب‌سایت معرفی و رزرو وقت برای آتلیه‌ی عکاسی رها",
      color: "#c9862e",
      startAgo: A.contractRaha,
      endAgo: A.rahaDelivered,
      status: "COMPLETED",
      weight: 1,
      tasks: [
        "جمع‌بندی نیازمندی‌ها با رها",
        "طراحی وایرفریم صفحه‌ی اصلی",
        "انتخاب پالت رنگی و فونت",
        "طراحی صفحه‌ی اصلی در فیگما",
        "طراحی گالری نمونه‌کارها",
        "طراحی صفحه‌ی درباره‌ی ما",
        "پیاده‌سازی صفحه‌ی اصلی",
        "ساخت گالری با لایت‌باکس",
        "فرم رزرو وقت عکاسی",
        "اتصال فرم به ایمیل آتلیه",
        "بهینه‌سازی حجم تصاویر",
        "نسخه‌ی موبایل صفحه‌ها",
        "تنظیمات سئوی پایه",
        "تست روی مرورگرهای مختلف",
        "اعمال بازخوردهای رها",
        "راه‌اندازی هاست و دامنه",
        "آموزش پنل مدیریت به رها",
      ],
      sessions: ["طراحی صفحه‌ی اصلی", "چیدمان گالری نمونه‌کارها", "کدنویسی فرم رزرو", "رفع ایرادهای نسخه‌ی موبایل", "بهینه‌سازی تصاویر", "بازبینی رنگ‌ها و فونت", "تنظیم انیمیشن‌ها"],
      payments: [
        { ago: A.contractRaha, amount: 30_000_000, note: "پیش‌پرداخت سایت آتلیه‌ی رها" },
        { ago: A.rahaDelivered, amount: 30_000_000, note: "تسویه‌ی نهایی آتلیه‌ی رها" },
      ],
    },
    {
      key: "music",
      name: "اپ آموزش موسیقی",
      description: "اپ موبایل آموزش گیتار برای آقای شیرازی — بدون پاسخ از سمت مشتری، متوقف شد",
      color: "#8a7ac9",
      startAgo: work(165),
      endAgo: A.musicGhost,
      status: "ARCHIVED",
      weight: 0.35,
      tasks: ["طراحی صفحه‌های اصلی اپ", "طراحی جریان تمرین روزانه", "پیاده‌سازی پخش‌کننده‌ی ویدیو"],
      sessions: ["طراحی صفحه‌های اپ آموزش موسیقی", "پیاده‌سازی پخش‌کننده"],
      payments: [{ ago: work(165), amount: 12_000_000, note: "پیش‌پرداخت اپ آموزش موسیقی" }],
    },
    {
      key: "tea",
      name: "فروشگاه آنلاین چای‌سرا",
      description: "بازطراحی و ساخت فروشگاه اینترنتی چای برای خانم صالحی",
      color: "#4f9c5c",
      startAgo: A.teaStart,
      endAgo: A.teaDelivered,
      status: "COMPLETED",
      weight: 1.1,
      tasks: [
        "بررسی سایت فعلی و رقبا",
        "طراحی معماری اطلاعات",
        "طراحی صفحه‌ی محصول",
        "طراحی سبد خرید و پرداخت",
        "طراحی صفحه‌ی دسته‌بندی",
        "ساخت کامپوننت‌های سیستم طراحی",
        "پیاده‌سازی صفحه‌ی محصول",
        "پیاده‌سازی جستجو و فیلتر",
        "اتصال به درگاه پرداخت",
        "رفع باگ‌های سبد خرید",
        "تنظیمات ارسال و هزینه‌ی پست",
        "تست نهایی با دو سفارش واقعی",
        "پیگیری تسویه‌ی مبلغ باقی‌مانده",
      ],
      sessions: ["طراحی صفحه‌ی محصول", "طراحی سبد خرید", "کدنویسی جستجو و فیلتر", "اتصال درگاه پرداخت", "رفع باگ سبد خرید", "ساخت کامپوننت‌ها", "تست سفارش‌ها"],
      payments: [
        { ago: A.teaStart, amount: 35_000_000, note: "پیش‌پرداخت فروشگاه چای‌سرا" },
        { ago: work(122), amount: 30_000_000, note: "مرحله‌ی دوم فروشگاه چای‌سرا" },
        { ago: teaDelivered - 2, amount: 30_000_000, note: "تسویه‌ی نهایی فروشگاه چای‌سرا" },
      ],
    },
    {
      key: "parvaz",
      name: "لندینگ استارتاپ پرواز",
      description: "صفحه‌ی فرود و فرم ثبت‌نام برای استارتاپ امیرحسین",
      color: "#4a90c9",
      startAgo: A.parvazStart,
      endAgo: A.parvazDone,
      status: "COMPLETED",
      weight: 0.8,
      tasks: ["شنیدن ایده‌ی محصول از امیرحسین", "طراحی ساختار لندینگ", "طراحی نسخه‌ی اول", "انیمیشن بخش قهرمان", "پیاده‌سازی و فرم ثبت‌نام", "تحویل و بازخورد نهایی"],
      sessions: ["ساختار لندینگ", "طراحی بخش قهرمان", "انیمیشن اسکرول", "کدنویسی فرم ثبت‌نام"],
      payments: [
        { ago: A.parvazStart, amount: 14_000_000, note: "پیش‌پرداخت لندینگ پرواز" },
        { ago: A.parvazDone, amount: 14_000_000, note: "تسویه‌ی لندینگ پرواز" },
      ],
    },
    {
      key: "bam",
      name: "اپ منوی رستوران بام",
      description: "منوی دیجیتال با QR، پنل مدیریت و چاپ سفارش در آشپزخانه",
      color: "#c95a4c",
      startAgo: A.bamStart,
      endAgo: A.bamDelivered,
      status: "COMPLETED",
      weight: 1.3,
      tasks: [
        "برداشت نیازها از آقای فرهادی",
        "طراحی جریان سفارش از روی QR",
        "طراحی منوی دیجیتال",
        "ساخت پنل مدیریت منو",
        "پیاده‌سازی نمایش منو",
        "پشتیبانی چندزبانه (فارسی و انگلیسی)",
        "اتصال به چاپگر آشپزخانه",
        "تست در رستوران با گارسون‌ها",
        "آموزش کارکنان رستوران",
        "تحویل نهایی اپ منو",
      ],
      sessions: ["طراحی منوی دیجیتال", "پنل مدیریت منو", "کدنویسی نمایش منو", "پشتیبانی چندزبانه", "اتصال به چاپگر آشپزخانه", "تست با گارسون‌ها", "رفع باگ‌های سفارش"],
      payments: [
        { ago: A.bamStart, amount: 40_000_000, note: "پیش‌پرداخت اپ منوی بام" },
        { ago: work(70), amount: 40_000_000, note: "مرحله‌ی دوم اپ منوی بام" },
        { ago: work(49), amount: 40_000_000, note: "تسویه‌ی نهایی اپ منوی بام" },
      ],
    },
    {
      key: "nay",
      name: "کیت رابط کاربری «نی»",
      description: "محصول شخصی: کیت رابط کاربری فارسی و راست‌به‌چپ برای فروش",
      color: "#3a8d80",
      startAgo: A.nayStart,
      endAgo: null,
      status: "ACTIVE",
      weight: 0.7,
      tasks: [
        "تعریف دامنه‌ی محصول و مخاطب",
        "طراحی توکن‌های رنگ و تایپوگرافی",
        "طراحی ۳۰ کامپوننت پایه",
        "نسخه‌ی تیره‌ی کیت",
        "مستندسازی کامپوننت‌ها",
        "ساخت صفحه‌ی فروش کیت",
        "ضبط ویدیوی معرفی",
        "پیش‌فروش به ده نفر اول",
        "پاسخ به پرسش‌های خریداران",
        "نسخه‌ی دوم کیت با آیکون‌ها",
      ],
      doneCount: 8,
      sessions: ["طراحی کامپوننت‌های پایه", "توکن‌های رنگ و تایپوگرافی", "نسخه‌ی تیره‌ی کیت", "مستندسازی کامپوننت‌ها", "ساخت صفحه‌ی فروش", "ضبط ویدیوی معرفی"],
      payments: [
        { ago: 40, amount: 2_900_000, note: "فروش کیت نی" },
        { ago: 33, amount: 5_800_000, note: "فروش کیت نی (دو نسخه)" },
        { ago: 24, amount: 8_700_000, note: "فروش کیت نی (سه نسخه)" },
        { ago: 15, amount: 5_800_000, note: "فروش کیت نی (دو نسخه)" },
        { ago: 6, amount: 8_700_000, note: "فروش کیت نی (سه نسخه)" },
      ],
    },
    {
      key: "aftab",
      name: "سایت دوره‌ی زبان آفتاب",
      description: "سیستم ثبت‌نام، پرداخت شهریه و آزمون تعیین سطح برای یک آموزشگاه زبان",
      color: "#b0a24a",
      startAgo: A.aftabStart,
      endAgo: A.aftabDelivered,
      status: "COMPLETED",
      weight: 0.9,
      tasks: [
        "طراحی صفحه‌ی ثبت‌نام دوره",
        "ساخت برنامه‌ی کلاس‌ها",
        "پیاده‌سازی پروفایل زبان‌آموز",
        "صفحه‌ی پرداخت شهریه",
        "پیامک یادآوری کلاس",
        "آزمون تعیین سطح آنلاین",
        "تحویل و آموزش مدیر آموزش",
      ],
      sessions: ["طراحی صفحه‌ی ثبت‌نام", "پیاده‌سازی پروفایل زبان‌آموز", "صفحه‌ی پرداخت شهریه", "آزمون تعیین سطح آنلاین", "پیامک یادآوری کلاس"],
      payments: [
        { ago: A.aftabStart, amount: 20_000_000, note: "پیش‌پرداخت سایت آفتاب" },
        { ago: A.aftabDelivered, amount: 35_000_000, note: "تسویه‌ی سایت آفتاب" },
      ],
    },
    {
      key: "mehrad",
      name: "بازطراحی داشبورد شرکت مهراد",
      description: "بازطراحی داشبورد داخلی شرکت مهراد، با مصاحبه‌ی کاربران",
      color: "#2c7166",
      startAgo: A.mehradStart,
      endAgo: null,
      status: "ACTIVE",
      weight: 1.2,
      tasks: [
        "مصاحبه با سه کاربر داخلی",
        "تحلیل داشبورد فعلی",
        "طراحی نمودارها و کارت‌های شاخص",
        "طراحی حالت تاریک",
        "ارائه‌ی نسخه‌ی اول به تیم",
        "اصلاحات بعد از ارائه",
        "تحویل فایل‌های طراحی به تیم فنی",
        "پشتیبانی از پیاده‌سازی",
      ],
      doneCount: 6,
      sessions: ["مصاحبه و تحلیل کاربران", "طراحی نمودارها", "طراحی کارت‌های شاخص", "حالت تاریک داشبورد", "پیاده‌سازی نمونه‌ی اول", "اصلاحات بعد از ارائه"],
      payments: [
        { ago: A.mehradStart, amount: 30_000_000, note: "پیش‌پرداخت داشبورد مهراد" },
        { ago: 19, amount: 30_000_000, note: "مرحله‌ی دوم داشبورد مهراد" },
      ],
    },
    {
      key: "blog",
      name: "وبلاگ شخصی",
      description: "نوشتن درباره‌ی چیزهایی که در فریلنس یاد گرفته‌ام",
      color: "#6b8a9c",
      startAgo: A.blogStart,
      endAgo: null,
      status: "ACTIVE",
      weight: 0.35,
      tasks: ["طراحی قالب وبلاگ", "نوشتن مقاله‌ی اول: شش ماه فریلنس", "ویرایش و بازنویسی مقاله‌ی اول", "نوشتن مقاله‌ی دوم: قرارداد و محدوده‌ی کار"],
      doneCount: 3,
      sessions: ["نوشتن مقاله", "ویرایش و بازنویسی", "طراحی قالب وبلاگ"],
      payments: [],
    },
  ];

  const events: StoryEvent[] = [
    { ago: 181, hour: 13, duration: 180, title: "ناهار عید خانه‌ی مادربزرگ", category: "خانواده", place: "شمیران" },
    { ago: 179, hour: 17, duration: 120, title: "دیدوبازدید عید با رضا و مریم", category: "تفریح" },
    { ago: 176, hour: 19, duration: 120, title: "شام خانوادگی خانه‌ی عمو", category: "خانواده" },
    { ago: A.callRaha, hour: 15, minute: 30, duration: 30, title: "تماس اولیه با رها", category: "کار", place: "تلفنی" },
    { ago: A.contractRaha, hour: 11, duration: 90, title: "جلسه‌ی شروع پروژه — آتلیه‌ی رها", category: "کار", project: "raha", place: "آتلیه‌ی رها، ونک" },
    { ago: work(165), hour: 10, minute: 30, duration: 45, title: "بازبینی وایرفریم با رها", category: "کار", project: "raha", place: "آنلاین" },
    { ago: weekend(158), hour: 14, duration: 60, title: "دندان‌پزشکی — جرم‌گیری", category: "سلامت" },
    { ago: A.referral, hour: 10, duration: 45, title: "تماس با خانم صالحی (معرفی رها)", category: "کار", place: "تلفنی" },
    { ago: A.teaStart, hour: 11, duration: 75, title: "جلسه‌ی شروع پروژه‌ی چای‌سرا", category: "کار", project: "tea", place: "دفتر چای‌سرا، ولیعصر" },
    { ago: work(146), hour: 10, duration: 45, title: "بازبینی نمونه‌ی رنگ‌ها — آتلیه‌ی رها", category: "کار", project: "raha", place: "آنلاین" },
    { ago: A.parvazStart, hour: 16, duration: 60, title: "جلسه‌ی اول با امیرحسین (پرواز)", category: "کار", project: "parvaz", place: "آنلاین" },
    { ago: A.rahaFeedback, hour: 12, duration: 60, title: "جلسه‌ی بازخورد نهایی — آتلیه‌ی رها", category: "کار", project: "raha", place: "آتلیه‌ی رها" },
    { ago: A.musicGhost, hour: 9, minute: 30, duration: 30, title: "تماس با آقای شیرازی (بی‌پاسخ)", category: "کار", project: "music", place: "تلفنی", attended: false },
    { ago: A.rahaDelivered, hour: 11, duration: 60, title: "تحویل سایت آتلیه‌ی رها", category: "کار", project: "raha", place: "آتلیه‌ی رها" },
    { ago: A.rezaBirthday, hour: 19, duration: 150, title: "تولد رضا", category: "تفریح", place: "خانه‌ی رضا" },
    { ago: A.parvazDone, hour: 15, duration: 45, title: "تحویل لندینگ پرواز", category: "کار", project: "parvaz", place: "آنلاین" },
    { ago: A.scopeCreep, hour: 10, duration: 75, title: "جلسه‌ی مرور محدوده‌ی کار با خانم صالحی", category: "کار", project: "tea", place: "آنلاین" },
    { ago: A.hardTalk, hour: 11, duration: 90, title: "گفت‌وگو درباره‌ی تغییرات اضافه‌ی چای‌سرا", category: "کار", project: "tea", place: "دفتر چای‌سرا" },
    { ago: A.teaDelivered, hour: 11, duration: 60, title: "تحویل نهایی فروشگاه چای‌سرا", category: "کار", project: "tea", place: "دفتر چای‌سرا" },
    { ago: tripStart, hour: 8, duration: 0, title: "سفر شیراز — رفتن", category: "خانواده", allDay: true },
    { ago: tripStart - 1, hour: 8, duration: 0, title: "سفر شیراز — حافظیه و باغ ارم", category: "خانواده", allDay: true },
    { ago: tripStart - 2, hour: 8, duration: 0, title: "سفر شیراز — برگشت", category: "خانواده", allDay: true },
    { ago: A.bamStart, hour: 10, duration: 90, title: "جلسه‌ی شروع پروژه‌ی اپ منوی بام", category: "کار", project: "bam", place: "رستوران بام، سعادت‌آباد" },
    { ago: weekend(80), hour: 20, duration: 120, title: "شام با کامران و رضا", category: "تفریح" },
    { ago: work(76), hour: 15, duration: 60, title: "مهمان پادکست فریلنسرها", category: "کار", place: "آنلاین" },
    { ago: A.aftabStart, hour: 11, duration: 60, title: "جلسه‌ی شروع سایت دوره‌ی آفتاب", category: "کار", project: "aftab", place: "آموزشگاه آفتاب" },
    { ago: A.checkup, hour: 9, duration: 60, title: "چکاپ سالانه", category: "سلامت" },
    { ago: A.momBirthday, hour: 18, duration: 150, title: "تولد مامان", category: "خانواده", place: "خانه‌ی مامان" },
    { ago: A.bamDelivered, hour: 14, duration: 90, title: "تست نهایی اپ منو در رستوران", category: "کار", project: "bam", place: "رستوران بام" },
    { ago: A.bamOpening, hour: 20, duration: 180, title: "افتتاحیه‌ی بازسازی رستوران بام", category: "تفریح", place: "رستوران بام" },
    { ago: A.mehradStart, hour: 11, duration: 75, title: "جلسه‌ی شروع داشبورد مهراد", category: "کار", project: "mehrad", place: "شرکت مهراد، پاسداران" },
    { ago: A.interviewOne, hour: 15, duration: 60, title: "مصاحبه با کاربر داخلی مهراد — اول", category: "کار", project: "mehrad", place: "شرکت مهراد" },
    { ago: A.interviewTwo, hour: 11, duration: 60, title: "مصاحبه با کاربر داخلی مهراد — دوم", category: "کار", project: "mehrad", place: "شرکت مهراد" },
    { ago: work(35), hour: 19, duration: 90, title: "وبینار طراحی سیستم‌های طراحی", category: "یادگیری", place: "آنلاین" },
    { ago: A.aftabDelivered, hour: 14, duration: 45, title: "تحویل سایت آفتاب", category: "کار", project: "aftab", place: "آموزشگاه آفتاب" },
    { ago: weekend(25), hour: 18, duration: 120, title: "دورهمی دوستان دبیرستان", category: "تفریح" },
    { ago: A.mehradPresent, hour: 10, duration: 60, title: "ارائه‌ی نسخه‌ی اول داشبورد به تیم مهراد", category: "کار", project: "mehrad", place: "شرکت مهراد" },
    { ago: A.accountant, hour: 16, duration: 30, title: "تماس با حسابدار — بستن حساب فصل", category: "مالی", place: "تلفنی" },
    { ago: A.dentistAgain, hour: 9, minute: 30, duration: 45, title: "دندان‌پزشکی — پیگیری", category: "سلامت" },
    { ago: A.kamranBirthday, hour: 19, duration: 120, title: "شام تولد کامران", category: "تفریح" },
    { ago: A.mehradRevisions, hour: 11, duration: 60, title: "جلسه‌ی اصلاحات داشبورد مهراد", category: "کار", project: "mehrad", place: "شرکت مهراد" },
    { ago: A.newLead, hour: 15, duration: 45, title: "تماس با شرکت آرمان (مشتری احتمالی)", category: "کار", place: "تلفنی" },
    // The evening before, he wrote that this review is tomorrow.
    { ago: 0, hour: 10, minute: 30, duration: 60, title: "جلسه‌ی مرور با سعید (مهراد)", category: "کار", project: "mehrad", place: "آنلاین" },
    // Something later today, so the last page of the story has a "still ahead" line for most of the day.
    { ago: 0, hour: 20, minute: 30, duration: 120, title: "شام خانوادگی", category: "خانواده", attended: false },
  ];

  const recurring: Story["recurring"] = [{ title: "جلسه‌ی هفتگی با کامران", category: "کار", weekday: 6, hour: 10, duration: 60, fromAgo: 149, toAgo: null }];
  const weekly: Story["weekly"] = [{ title: "کلاس زبان انگلیسی", category: "یادگیری", weekday: 2, hour: 18, minute: 30, duration: 90, fromAgo: 121, toAgo: 41 }];

  // --- the notes he leaves himself ----------------------------------------------------------------------------
  const notes: StoryNote[] = [
    { ago: 183, hour: 22, keepDay: true, text: "امروز بالاخره این برنامه را نصب کردم. هدفم برای امسال ساده است: بفهمم واقعاً وقتم کجا می‌رود و از این کار چقدر درمی‌آید. عید هنوز تمام نشده، ولی می‌خواهم از همین امروز ثبت کنم." },
    { ago: 182, hour: 23, keepDay: true, text: "همه‌ی روز مهمانی بود و چیزی از کار پیش نرفت. اشکالی ندارد؛ فردا هم عید است." },
    { ago: 180, hour: 21, text: "امروز دفتر کار را مرتب کردم، قفسه‌ها را پاک کردم و فیگما را به‌روز کردم. حس یک شروع تازه را دارد." },
    { ago: 178, hour: 20, text: "به چهار مشتری قدیمی پیام دادم که برای پروژه‌های جدید آزادم. دو نفرشان زود جواب دادند. نگرانم که بهار بی‌مشتری بگذرد، ولی حداقل قدم اول برداشته شد." },
    { ago: 176, hour: 22, keepDay: true, text: "شام خانه‌ی عمو بود. همه می‌پرسیدند «کارت چطور است؟» و من هنوز جواب روشنی نداشتم. باید سال دیگر جوابم عدد و پروژه باشد، نه «خوب است»." },
    { ago: A.callRaha, hour: 21, text: "با رها صحبت کردم؛ عکاسی که سایت قدیمی‌اش تا حد دردناکی کند است. قرار گذاشتیم به‌زودی حضوری ببینیم. کمی استرس دارم، مثل اولین بار." },
    { ago: A.contractRaha, hour: 22, text: "قرارداد بسته شد! رها از نمونه‌کارها خوشش آمد، کمی چانه زد ولی قبول کرد. پیش‌پرداختش هم این هفته می‌آید. اولین پروژه‌ی امسال رسمی شد." },
    { ago: 170, hour: 21, text: "اولین روز کاری واقعی بعد از عید. بدنم هنوز در حالت تعطیلات بود، ولی وایرفریم اول را تمام کردم." },
    { ago: 167, hour: 22, text: "کمردرد دارد شروع می‌شود. سه چهار ساعت پشت‌سر هم می‌نشینم و بلند نمی‌شوم. باید ورزش را جدی بگیرم." },
    { ago: 165, hour: 8, text: "صبح اولین بار بعد از مدت‌ها بیرون رفتم و نیم ساعت دویدم. نفسم بند آمد ولی حالم خیلی بهتر شد." },
    { ago: 162, hour: 23, text: "فهمیدم وقتی می‌نویسم امروز چه کردم، حس می‌کنم جلو رفته‌ام؛ حتی اگر فقط دو ساعت کار کرده باشم. کاش زودتر شروع کرده بودم." },
    { ago: A.firstDeposit, hour: 14, text: "پیش‌پرداخت رها آمد. اولین پول امسال از کار خودم. عجیب است که یک عدد در حساب چقدر آدم را آرام می‌کند." },
    { ago: 157, hour: 22, text: "رها هر ده دقیقه یک عکس تازه می‌فرستد و می‌گوید «این را هم بگذار». دارم یاد می‌گیرم قبل از شروع، تعداد عکس‌ها را در قرارداد بنویسم." },
    { ago: 155, hour: 23, text: "امروز کارم حدود پنج ساعت شد. تمرین می‌کنم ساعت‌های واقعی را ببینم، نه ساعت‌هایی که فکر می‌کنم کار کرده‌ام." },
    { ago: A.referral, hour: 20, text: "رها مرا به خانم صالحی معرفی کرد؛ صاحب یک چای‌سرای آنلاین. تلفنی صحبت کردیم و حس خوبی داشت. گفت می‌خواهد هرچه زودتر شروع کند." },
    { ago: A.teaStart, hour: 22, text: "پروژه‌ی چای‌سرا شروع شد و حالا دو پروژه‌ی هم‌زمان دارم؛ اولین بار است. کمی ترسناک است ولی هیجان‌انگیز." },
    { ago: 149, hour: 22, text: "از این هفته هر هفته با کامران قرار داریم؛ می‌نشینیم و به هم می‌گوییم هفته‌ی گذشته چه کردیم و هفته‌ی بعد چه. فقط همین کار باعث می‌شود جدی‌تر باشم." },
    { ago: 146, hour: 22, text: "سه روز پشت‌سر هم بیش از هفت ساعت کار کردم. امشب سرم درد می‌کند. باید برای خودم سقف بگذارم." },
    { ago: 143, hour: 21, text: "امروز فقط کارهای کوچک انجام دادم و باز هم حس شکست نداشتم. قبلاً روزی که «کار بزرگ» نمی‌کردم خودم را سرزنش می‌کردم." },
    { ago: A.parvazStart, hour: 20, text: "امیرحسین، مؤسس یک استارتاپ، یک لندینگ می‌خواهد و بیشتر از یکی دو هفته وقت ندارد. پروژه‌ی کوچک ولی سریع. قبول کردم." },
    { ago: 138, hour: 23, text: "سه پروژه را هم‌زمان جابه‌جا می‌کنم و دارم می‌فهمم که پریدن ذهنی بین پروژه‌ها هم خودش وقت می‌برد؛ حدود بیست دقیقه هر بار." },
    { ago: A.rahaFeedback, hour: 21, text: "رها بعد از دیدن نسخه‌ی نهایی خواست رنگ‌ها را عوض کنم و فونت را هم. نفس عمیق کشیدم. یادم باشد بازخورد سخت هم بخشی از کار است، نه توهین." },
    { ago: 134, hour: 22, text: "برای اولین بار به «نه» گفتم: مشتری تازه‌ای با نصف قیمت می‌خواست. حالم بهتر از انتظارم بود." },
    { ago: A.musicGhost, hour: 20, text: "آقای شیرازی، مشتری اپ موسیقی، بیش از دو هفته است جواب نمی‌دهد. پروژه را متوقف می‌کنم؛ بخشی از پیش‌پرداخت را نگه می‌دارم و درسش را هم." },
    { ago: 131, hour: 22, text: "نمونه‌ی رها تقریباً آماده است. عکس‌های صفحه‌ی اصلی واقعاً زیبا شده‌اند." },
    { ago: 129, hour: 23, text: "فردا تحویل است. یک بار دیگر همه‌ی لینک‌ها را چک کردم. نگرانی مثل همیشه." },
    { ago: A.rahaDelivered, hour: 18, text: "سایت رها آنلاین شد! رها وقتی صفحه‌ی اصلی را دید گفت «این همان چیزی است که در ذهنم بود». تسویه‌ی نهایی هم همان روز آمد. اولین پروژه‌ی بزرگ امسال تمام شد." },
    { ago: 127, hour: 22, keepDay: true, text: "امروز فقط استراحت. بعد از تحویل پروژه مغزم خالی شده. ورزش هم نکردم و اشکالی ندارد." },
    { ago: A.rezaBirthday, hour: 23, keepDay: true, text: "تولد رضا بود. خیلی وقت بود همه را یک‌جا ندیده بودم. یادم باشد فقط کار نیست." },
    { ago: 121, hour: 21, text: "کلاس انگلیسی را از این هفته شروع کردم. اگر می‌خواهم با مشتری خارجی کار کنم باید حرف زدنم بهتر شود." },
    { ago: A.parvazDone, hour: 19, text: "لندینگ پرواز هم تحویل شد. امیرحسین گفت اگر سرمایه گرفتند سراغ من می‌آیند. امیدوارم." },
    { ago: 116, hour: 22, text: "خستگی دارد جمع می‌شود. از صبح فقط کار کرده‌ام و شب هم سرم پر از فکر است." },
    { ago: 115, hour: 8, text: "تصمیم گرفتم مدیتیشن را امتحان کنم؛ روزی ده دقیقه. اگر هیچ چیز دیگری نشود، حداقل ده دقیقه بی‌گوشی خواهم بود." },
    { ago: 113, hour: 23, text: "مدیتیشن روز دوم: ذهنم مثل مرغ سرکنده می‌دوید. ولی تا آخر نشستم." },
    { ago: A.scopeCreep, hour: 21, text: "خانم صالحی می‌خواهد کل بخش وبلاگ هم رایگان به پروژه اضافه شود چون «کار زیادی نیست». این سومین باری است که چیزی خارج از قرارداد می‌خواهد." },
    { ago: Math.max(A.headache + 1, 110), hour: 22, text: "باید درباره‌ی محدوده‌ی کار صحبت کنم. قبلاً از دعوا فرار می‌کردم و بعد ناراضی می‌ماندم. این بار با ایمیل مکتوب و مؤدبانه." },
    { ago: A.headache, hour: 22, keepDay: true, text: "سرم درد می‌کند و بدنم کوفته است." },
    { ago: A.fever, hour: 20, keepDay: true, text: "تب دارم. دکتر گفت آنفلوانزاست. چند روز آفلاین می‌شوم." },
    { ago: A.backAtWork, hour: 21, text: "دوباره سر کار. هنوز کم‌جانم ولی فکرم روشن‌تر است. این چند روز اجباری فهمیدم بی‌نظمی در مالی برایم چقدر خطرناک است؛ اگر تب نداشتم هم باید یک صندوق اضطراری داشته باشم." },
    { ago: A.hardTalk, hour: 22, text: "جلسه‌ی سخت با خانم صالحی. همه‌ی نگرانی‌هایم را نوشته بودم و خواندم. آرام بود و کمی هم عذرخواهی کرد. قرار شد بخش وبلاگ پروژه‌ی جداگانه باشد." },
    { ago: A.newRule, hour: 23, text: "قانون تازه: هر درخواستی که خارج از قرارداد بود، برآورد جدید. بدون استثنا. این جمله را روی یک کاغذ نوشتم و کنار میزم چسباندم." },
    { ago: A.deepFocus, hour: 22, text: "امروز سه ساعت کد زدم بدون اینکه یک بار گوشی را نگاه کنم. حس خوبی دارد." },
    { ago: A.teaDelivered, hour: 19, text: "فروشگاه چای‌سرا تحویل شد. ولی مبلغ باقی‌مانده هنوز نیامده؛ خانم صالحی گفته تا آخر هفته. یاد می‌گیرم حتماً در قرارداد بنویسم تحویل نهایی یعنی تسویه‌ی کامل." },
    { ago: A.teaPaid, hour: 22, text: "مبلغ باقی‌مانده آمد. نفس راحتی کشیدم. تجربه‌ی سختی بود ولی چیزهای مهمی یاد گرفتم: قرارداد دقیق، برآورد برای تغییرات و «نه» گفتن." },
    { ago: A.tripStart, hour: 21, keepDay: true, text: "رسیدیم شیراز. فقط با خانواده‌ام. لپ‌تاپ را نیاورده‌ام و قرار است سه روز کاملاً بیکار باشم." },
    { ago: A.tripStart - 1, hour: 22, keepDay: true, text: "حافظیه و باغ ارم. یادم رفته بود بدون عجله راه رفتن چقدر خوب است. عکس‌های زیادی گرفتم ولی بیشترش را برای خودم نگه می‌دارم." },
    { ago: A.tripStart - 2, hour: 23, keepDay: true, text: "برگشتیم. خسته ولی سرحال. اولین بار است بعد از شروع فریلنس یک سفر واقعی داشتم." },
    { ago: A.bamStart, hour: 20, text: "پروژه‌ی اپ منوی رستوران بام: بزرگ‌ترین پروژه‌ی امسال، صد و بیست میلیون. آقای فرهادی آدم دقیقی است و همین برایم اطمینان‌بخش است. بار اول است سه مرحله‌ی پرداخت می‌بندم." },
    { ago: 85, hour: 22, text: "مدیتیشن الان یک عادت جاافتاده شده. صبح‌ها پیش از ایمیل‌ها می‌نشینم." },
    { ago: 82, hour: 23, text: "اپ منو پیچیده‌تر از انتظارم است: چندزبانه، پنل مدیریت، چاپ سفارش در آشپزخانه. برای اولین بار به کامران پیشنهاد دادم بخشی از بک‌اند را با هم بزنیم." },
    { ago: 79, hour: 22, text: "کامران قبول کرد بک‌اند را او بنویسد و من تمرکزم را بگذارم روی رابط. عجیب است که واگذار کردن چقدر آدم را سبک می‌کند." },
    { ago: 76, hour: 21, text: "فکر تازه: کیت رابط کاربری برای فروش. شش ماه پیش چنین ایده‌ای را جدی نمی‌گرفتم. حالا فکر می‌کنم اگر هر شب یک ساعت وقت بگذارم، تا آخر تابستان آماده‌اش می‌کنم." },
    { ago: A.nayStart, hour: 22, text: "پروژه‌ی «نی» را رسماً باز کردم. اسمش را «نی» گذاشتم چون ساده و سبک است." },
    { ago: 72, hour: 22, text: "امروز چهار ساعت روی کیت کار کردم و یک ساعت هم روی پروژه‌ی بام. دارم می‌فهمم کار شخصی را باید در ساعت‌های ثابت بگذارم وگرنه همیشه عقب می‌افتد." },
    { ago: A.aftabStart, hour: 21, text: "آموزشگاه آفتاب: سایت ثبت‌نام و پرداخت شهریه. پروژه‌ی متوسط. با همین ظرفیتم پر شد؛ باید از حالا «نه» را جدی بگویم." },
    { ago: 66, hour: 23, text: "چهار پروژه‌ی هم‌زمان. یک جدول هفتگی ساختم که هر روز کدام پروژه اولویت دارد." },
    { ago: 63, hour: 22, text: "امروز ساعت‌ها را جمع زدم: شش ساعت کار مفید. بیشتر از این نمی‌شود." },
    { ago: A.checkup, hour: 22, text: "چکاپ سالانه دادم؛ همه‌چیز خوب است جز کمی چربی خون. ورزش را باید ادامه بدهم. با خودم قرار گذاشتم سی روز پشت‌سر هم بدوم." },
    { ago: 60, hour: 23, text: "از امشب هر شب پیش از خوابیدن چند خط برای خودم می‌نویسم. اسمش را گذاشته‌ام «دفتر شبانه»." },
    { ago: 54, hour: 22, text: "روز هفتم دویدن پشت‌سر هم. زانوهایم هنوز می‌گویند آرام‌تر." },
    { ago: A.momBirthday, hour: 23, keepDay: true, text: "تولد مامان. مامان گفت «کمتر کار کن». گفتم چشم. هر دو می‌دانستیم دروغ است." },
    { ago: A.bamDelivered, hour: 19, text: "اپ منوی بام تحویل شد! در رستوران با گارسون‌ها تست کردیم و همه راضی بودند. آقای فرهادی گفت اسم مرا به دو سه رستوران دیگر می‌دهد." },
    { ago: A.bamOpening, hour: 23, keepDay: true, text: "افتتاحیه‌ی بازسازی رستوران بام بود. مرا به عنوان «کسی که منو را ساخته» معرفی کردند. یکی از ماندگارترین لحظه‌های امسال." },
    { ago: 47, hour: 22, text: "پول پروژه‌ی بام کامل آمد. اولین بار است حساب پس‌اندازم از خرج یک ماه بیشتر شده. به خودم گفتم آرام؛ هنوز راه دارد." },
    { ago: A.mehradStart, hour: 20, text: "شرکت مهراد می‌خواهد داشبورد داخلی‌اش را بازطراحی کند. با سعید صحبت کردم؛ مصاحبه با کاربران داخلی هم بخشی از کار است. این نوع پروژه را دوست دارم." },
    { ago: 43, hour: 22, text: "نوشتن دفتر شبانه دیگر آسان‌تر شده. گاهی فقط یک جمله." },
    { ago: 40, hour: 21, text: "اولین فروش کیت «نی»: یک نفر از تبریز خرید. مبلغ کوچک بود ولی واقعاً هیجان‌زده شدم؛ اولین محصول واقعی خودم." },
    { ago: A.interviewOne, hour: 22, text: "مصاحبه‌ی اول با کاربران داخلی: یکی‌شان گفت «داشبورد را باز نمی‌کنم چون گیج‌کننده است». همین جمله ارزش یک هفته کار را داشت." },
    { ago: 36, hour: 22, keepDay: true, text: "پاییز نزدیک است و همه‌چیز دارد برمی‌گردد به روال. بعد از تابستان طولانی حس تازه شدن دارم." },
    { ago: 35, hour: 20, text: "برای اولین بار درآمد یک ماه از صد میلیون گذشت. یک لحظه ایستادم و به خودم نگاه کردم؛ شش ماه پیش نمی‌دانستم ماه بعد را چطور بگذرانم." },
    { ago: 33, hour: 22, text: "ماه پرکاری بود ولی سه شب خوب خوابیدم و هر روز دویدم. این ترکیب قبلاً ممکن نبود." },
    { ago: A.aftabDelivered, hour: 19, text: "سایت آموزشگاه آفتاب تحویل شد. مدیر آموزش گفت اولین‌بار است سیستم ثبت‌نام‌شان بدون اکسل کار می‌کند!" },
    { ago: A.blogStart, hour: 21, text: "تصمیم گرفتم درباره‌ی چیزهایی که یاد گرفته‌ام بنویسم. وبلاگ شخصی، بدون سئو و بدون عجله. فقط برای خودم و شاید یک نفر دیگر." },
    { ago: 26, hour: 22, text: "مقاله‌ی اول: «شش ماه فریلنس؛ چه چیزهایی را دیرتر یاد گرفتم». پیش‌نویس سه ساعت طول کشید و هنوز راضی نیستم." },
    { ago: 24, hour: 23, keepDay: true, text: "امروز کاری نکردم که بشود گفت «کار». ولی ذهنم آرام بود و شب خوب نوشتم." },
    { ago: 22, hour: 22, text: "سه پروژه‌ی فعال دارم: مهراد، نی و وبلاگ. تصمیم گرفتم تا پایان مهر پروژه‌ی جدید نپذیرم. دو تماس دیگر را هم بی‌جواب گذاشتم." },
    { ago: 20, hour: 21, keepDay: true, text: "هفته‌ی سنگینی بود. ولی آخر هفته را کاملاً خاموش گذراندم و همین باعث شد با انرژی برگردم." },
    { ago: A.mehradPresent, hour: 18, text: "ارائه‌ی داشبورد به تیم مهراد: از آن ارائه‌هایی که وقتی تمام می‌شود می‌فهمی درست آماده کرده بودی." },
    { ago: A.accountant, hour: 21, text: "با حسابدار صحبت کردم؛ برای اولین بار بعد از شروع فریلنس از او خواستم برنامه‌ی مالیاتی بدهد. بزرگ شدن یعنی همین‌ها." },
    { ago: 15, hour: 22, keepDay: true, text: "یادم باشد خودم را با آدم‌های دیگر مقایسه نکنم. این را امروز سه بار به خودم گفتم." },
    { ago: 13, hour: 23, text: "امروز کامران گفت شاید سال بعد با هم یک استودیوی کوچک بزنیم. نه گفتم و نه آره؛ گفتم بگذار تا پاییز صبر کنیم." },
    { ago: 11, hour: 22, text: "کیت نی حالا حدود بیست خریدار دارد. یکی‌شان ایمیل زد که «کارتان به کارم آمد». همین یک خط ارزش تمام شب‌های خسته را داشت." },
    { ago: 9, hour: 22, keepDay: true, text: "خواندن کتاب را جدی گرفته‌ام؛ هر شب سی دقیقه. امروز نیمه‌ی کتاب را رد کردم." },
    { ago: 8, hour: 21, keepDay: true, text: "امشب را خوب می‌خوابم. فردا روز پری است." },
    { ago: 6, hour: 22, text: "روز خوبی بود؛ اصلاحات مهراد، دو ساعت تمرکز روی کیت و یک پیاده‌روی طولانی." },
    { ago: 5, hour: 23, keepDay: true, text: "گاهی به این فکر می‌کنم که اگر این دفتر را نمی‌نوشتم، هیچ‌کدام از این روزها را به یاد نمی‌آوردم." },
    { ago: 3, hour: 21, keepDay: true, text: "شش ماه است از این برنامه استفاده می‌کنم. می‌توانم مسیرم را ببینم: از یک آدم گیج بعد از عید تا کسی که پروژه‌هایش را می‌بندد و می‌داند چه می‌خواهد. هنوز خیلی مانده ولی جهت درست است." },
    { ago: 2, hour: 22, keepDay: true, text: "امروز کار زیادی نکردم ولی حس پیشرفت دارم. دارم به یک ریتم می‌رسم." },
    { ago: 1, hour: 22, keepDay: true, text: "فردا جلسه‌ی مرور با سعید است. اصلاحات آخر را فرستاده‌ام." },
    { ago: 0, hour: 8, keepDay: true, text: "صبح بخیر. مدیتیشن و دویدن انجام شد. کیت نی را با یک فنجان چای باز کردم." },
  ];

  const genericNotes = [
    "امروز روز آرامی بود.",
    "کمی خسته‌ام ولی راضی.",
    "ایده‌ی خوبی به ذهنم رسید؛ نوشتم که یادم نرود.",
    "امروز کارها روان پیش رفت.",
    "باید بیشتر آب بخورم!",
    "امروز بی‌حوصله بودم ولی کار را انجام دادم.",
    "هوا خوب بود و بعد از کار کمی پیاده‌روی کردم.",
    "شب‌ها باید زودتر بخوابم.",
    "چای گرم و کد تمیز؛ روز خوبی بود.",
    "تمرکز امروز خوب بود؛ گوشی را دور گذاشتم.",
    "امروز کمی پراکنده بودم؛ فردا بهتر می‌شود.",
    "یک کار سخت را بالاخره تمام کردم.",
    "کمی از کارهای عقب‌افتاده را جمع کردم.",
    "به خودم قول دادم فردا زودتر شروع کنم.",
    "روی کاغذ کار کمی داشتم ولی ذهنم سنگین بود.",
    "امروز بیشتر فکر کردم تا کار.",
    "بدون عجله کار کردم و همین خوب بود.",
    "قهوه‌ی عصر جواب داد.",
  ];

  const habits: StoryHabit[] = [
    {
      key: "run",
      title: "ورزش صبحگاهی",
      icon: "🏃",
      category: "ورزش",
      createdAgo: 183,
      hour: 7,
      chance: (ago) => (ago > 170 ? 0.3 : ago > 125 ? 0.62 : ago > 110 ? 0.85 : ago > 96 ? 0.5 : ago > 89 ? 0.3 : 0.78),
      // A month without a gap after the annual check-up, and the last ten days.
      forced: [
        [60, 31],
        [9, 0],
      ],
      durationChance: 0.5,
      durationRange: [25, 55],
      valuePerCheckIn: 60_000,
    },
    {
      key: "read",
      title: "مطالعه‌ی ۳۰ دقیقه‌ای",
      icon: "📚",
      category: "یادگیری",
      createdAgo: 175,
      hour: 22,
      chance: (ago) => (ago > 150 ? 0.45 : ago > 100 ? 0.6 : 0.72),
      forced: [[9, 0]],
      durationChance: 0.6,
      durationRange: [25, 45],
      valuePerCheckIn: 40_000,
    },
    {
      key: "meditate",
      title: "مدیتیشن ده‌دقیقه‌ای",
      icon: "🧘",
      category: "استراحت بدون تکنولوژی",
      createdAgo: 115,
      hour: 7,
      chance: () => 0.72,
      forced: [[20, 8]],
      durationChance: 0.9,
      durationRange: [10, 15],
      valuePerCheckIn: 30_000,
    },
    {
      key: "diary",
      title: "دفتر شبانه",
      icon: "📝",
      category: "شخصی",
      createdAgo: 60,
      hour: 23,
      chance: () => 0.55,
      forced: [[5, 0]],
      valuePerCheckIn: 20_000,
    },
    {
      key: "offline",
      title: "قطع اینترنت بعد از ۱۱ شب",
      icon: "🌙",
      category: "شخصی",
      createdAgo: 150,
      hour: 23,
      chance: (ago) => (ago > 100 ? 0.25 : 0.4),
      valuePerCheckIn: 20_000,
    },
  ];

  const personalTasks = [
    "پرداخت قبض برق",
    "پرداخت قبض اینترنت",
    "پاسخ به ایمیل‌های عقب‌افتاده",
    "مرتب کردن فایل‌های فیگما",
    "بکاپ گرفتن از هارد",
    "تمدید اشتراک فیگما",
    "خرید هدیه‌ی تولد",
    "تعویض روغن ماشین",
    "گرفتن نوبت دندان‌پزشک",
    "به‌روزرسانی رزومه و نمونه‌کارها",
    "نوشتن پست لینکدین درباره‌ی پروژه‌ی اخیر",
    "خرید مواد غذایی هفته",
    "شست‌وشوی ماشین",
    "مطالعه‌ی مقاله‌ای درباره‌ی تایپوگرافی فارسی",
    "پیدا کردن فونت مناسب برای پروژه‌ی جدید",
    "ساختن قالب قرارداد جدید",
    "تماس با پشتیبانی هاست",
    "به‌روزرسانی پکیج‌های پروژه‌ها",
    "چک کردن اسناد مالیاتی",
    "تمیز کردن میز کار",
    "ارسال فاکتور به مشتری",
    "پیگیری پرداخت مشتری",
    "تنظیم یادآور برای قراردادها",
    "مرتب کردن ایمیل‌ها و برچسب‌گذاری",
    "خرید کابل و لوازم جانبی",
    "دیدن آموزش انیمیشن در فیگما",
    "پاسخ به پیام‌های لینکدین",
    "بازبینی نمونه‌کارها",
  ];

  const learningSessions = ["یادگیری Next.js", "مطالعه‌ی مستندات React Query", "تمرین انیمیشن‌های CSS", "دیدن آموزش سیستم طراحی", "تمرین تایپوگرافی فارسی", "تمرین زبان انگلیسی"];
  const adminSessions = ["پاسخ به ایمیل‌ها و پیگیری مشتری", "حسابداری و فاکتورها", "برنامه‌ریزی هفته", "پیدا کردن مشتری جدید"];

  return {
    projects,
    events,
    recurring,
    weekly,
    notes,
    genericNotes,
    habits,
    personalTasks,
    learningSessions,
    adminSessions,
    sickDays: [sickStart, sickStart - 1, sickStart - 2],
    tripDays: [tripStart, tripStart - 1, tripStart - 2],
  };
}
