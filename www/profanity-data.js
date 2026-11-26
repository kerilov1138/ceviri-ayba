// CEVIRI - Kufur / agir hakaret listeleri (kufur filtresi icin)
//
// Bicim: dil -> { mode, words }
//   mode 'word': kelime sinirina gore eslesir (bosluklu diller)
//   mode 'sub' : metin icinde gecen her yerde eslesir (Cince, Japonca, Korece, Tayca)
//   Sonu '*' ile biten girdi: o kokle BASLAYAN her kelime (or. 'fuck*' -> fucking, fucker)
//   Bosluklu girdi: kelime grubu (aradaki bosluk sayisi onemsiz)
//
// Listeler bilincli olarak "gercek kufur ve agir hakaret" ile sinirli tutuldu:
// tibbi/cinsel saglik terimleri, kimlik kelimeleri ve baska anlami da olan
// gundelik kelimeler (or. Turkce 'sikke', 'gotur'; Cince 'nainai') eklenmedi.
// Eklemek/cikarmak icin ilgili dilin satirini duzenleyin.

// Butun dillerde ayrica aranan, baska dillerde anlami olmayan yaygin Ingilizce kufurler
export const PROFANITY_INTL = [
  'fuck*', 'motherfuck*', 'fck', 'fcking', 'wtf', 'stfu', 'shit', 'shitty', 'bullshit', 'bitch*', 'asshole*', 'cunt*',
];

export const PROFANITY = {
  tr: { mode: 'word', words: [
    'am', 'amk', 'aq', 'amq', 'amına*', 'amina koyim', 'amına koyayım', 'amına koyim', 'amını*', 'amcık*', 'amcik*', 'amı',
    'sik', 'siki', 'sike', 'sikim', 'sikime', 'sikin', 'sikini', 'sikik', 'siker', 'sikerim*', 'sikeyim*', 'sikiyim',
    'sikiyor*', 'sikti', 'siktim', 'siktin', 'siktir*', 'sikiş*', 'sikis*', 'sikmek', 'sikmem', 'sikmiş*', 'sikerler', 'sikindirik*',
    'yarak*', 'yarrak*', 'yarağ*', 'yarrağ*', 'yarram*', 'dalyarak*', 'dalyarrak*', 'taşak*', 'taşşak*', 'tasak*',
    'göt', 'götü', 'götün', 'göte', 'götte', 'götten', 'götler*', 'götveren*', 'götlek*', 'götoş*',
    'orospu*', 'oruspu*', 'orosbu*', 'piç', 'piçler*', 'piçin', 'piçi', 'piçlik', 'ibne*', 'pezevenk*', 'yavşak*', 'yavsak*',
    'kaltak*', 'kahpe*', 'gavat*', 'puşt*', 'pust', 'şerefsiz*', 'serefsiz*', 'oç', 'o.ç', 'o ç', 'sürtük*', 'kevaşe*',
    'sıçmak', 'sıçtı*', 'sıçayım', 'sıçarım', 'sıçtığım*', 'sicmak', 'bok', 'boktan', 'boklu', 'pipi kafalı',
    'otuz birci*', 'saksocu*', 'ananı sikeyim', 'anasını sikeyim',   ] },
  en: { mode: 'word', words: [
    'fuck*', 'motherfuck*', 'fck', 'fcking', 'fuk', 'wtf', 'stfu', 'shit', 'shits', 'shitty', 'shithead*', 'shitface*', 'bullshit',
    'bitch*', 'bastard*', 'asshole*', 'arsehole*', 'ass', 'arse', 'jackass', 'dumbass', 'dickhead*', 'dick', 'dicks',
    'cock', 'cocks', 'cocksucker*', 'cunt*', 'pussy', 'pussies', 'whore*', 'slut*', 'twat*', 'wanker*', 'prick', 'pricks',
    'goddamn', 'goddamnit', 'damnit', 'faggot*', 'fag', 'fags', 'nigger*', 'nigga*', 'retard', 'retarded', 'douchebag*',
    'son of a bitch', 'piss off', 'jerk off', 'blowjob*', 'dipshit*', 'bollocks',
  ] },
  de: { mode: 'word', words: [
    'fick*', 'gefickt', 'scheiß*', 'scheiss*', 'scheisse', 'beschissen*', 'arschloch*', 'arsch', 'arschgesicht*', 'arschkriecher*',
    'hurensohn*', 'hurenkind*', 'hure', 'huren', 'fotze*', 'schlampe*', 'wichser*', 'wichse*', 'missgeburt*', 'spast', 'spasti*',
    'schwuchtel*', 'kanake*', 'neger', 'nutte*', 'pisser', 'drecksau*', 'drecksack*', 'dreckskerl*', 'miststück*', 'mistkerl*',
    'leck mich', 'verpiss dich', 'halt die fresse', 'fresse', 'schwanzlutscher*', 'pimmel*', 'möse*', 'muschi*',
  ] },
  fr: { mode: 'word', words: [
    'putain*', 'pute', 'putes', 'salope*', 'salopard*', 'connard*', 'connasse*', 'conne', 'con', 'cons', 'enculé*', 'encule*', 'enculer',
    'merde*', 'merdique', 'nique', 'niquer', 'niqué', 'nique ta mère', 'ntm', 'ta gueule', 'ferme ta gueule', 'couilles', 'couillon*',
    'bite', 'bites', 'fils de pute', 'fdp', 'pédé*', 'bâtard*', 'batard*', 'enfoiré*', 'enfoire*', 'salaud*', 'foutre', 'branleur*',
    'branlette', 'bordel de merde', 'chier', 'fais chier',
  ] },
  es: { mode: 'word', words: [
    'puta', 'putas', 'puto', 'putos', 'putada', 'mierda*', 'joder', 'jodido*', 'jódete', 'jodete', 'coño', 'cabrón', 'cabron',
    'cabrona', 'cabrones', 'gilipollas', 'hijo de puta', 'hija de puta', 'hijoputa', 'hijueputa', 'hdp', 'pendejo*', 'pendeja*',
    'chingar', 'chingada*', 'chingado*', 'chinga tu madre', 'verga', 'vergas', 'maricón*', 'maricon*', 'culero*', 'carajo',
    'cojones', 'follar', 'mamón*', 'mamon', 'malparido*', 'concha de tu madre', 'me cago en', 'gonorrea hp',   ] },
  it: { mode: 'word', words: [
    'cazzo', 'cazzi', 'cazzata*', 'cazzone*', 'minchia*', 'stronzo*', 'stronza*', 'stronzate', 'puttana*', 'puttanata', 'troia*',
    'vaffanculo*', 'fanculo', 'merda*', 'coglione*', 'coglioni', 'porco dio', 'porca madonna', 'porca puttana', 'bastardo*',
    'frocio*', 'mignotta*', 'zoccola*', 'bocchinara*', 'figlio di puttana', 'testa di cazzo', 'rompicoglioni', 'cornuto*',
  ] },
  pt: { mode: 'word', words: [
    'porra', 'caralho*', 'merda*', 'puta', 'putas', 'puto', 'putaria', 'foda*', 'foder', 'fodido*', 'fodida*', 'filho da puta',
    'filha da puta', 'fdp', 'buceta*', 'boceta*', 'cacete', 'viado*', 'arrombado*', 'arrombada*', 'cu', 'vai tomar no cu',
    'desgraçado*', 'desgracado*', 'cuzão', 'cuzao', 'vagabunda', 'pau no cu', 'babaca', 'otário', 'otario',
  ] },
  ru: { mode: 'word', words: [
    'хуй*', 'хуе*', 'хуё*', 'хуя*', 'хуи', 'нахуй', 'нахер', 'пизд*', 'распизд*', 'спизд*', 'ебат*', 'ебан*', 'ебал*', 'ебу', 'ебёт*',
    'ебет*', 'ёбан*', 'ёб', 'заеб*', 'заёб*', 'выеб*', 'поеб*', 'отъеб*', 'уеб*', 'наеб*', 'долбоёб*', 'долбоеб*', 'бля', 'блять', 'блядь',
    'бляд*', 'сука', 'суки', 'сукой', 'суку', 'сукин*', 'сучка*', 'мудак*', 'мудил*', 'пидор*', 'пидар*', 'гандон*', 'шлюх*', 'залуп*',
    'говно*', 'говню*', 'дерьмо', 'мразь', 'ублюдок*', 'ублюдк*', 'чмо',
  ] },
  uk: { mode: 'word', words: [
    'хуй*', 'хуя*', 'хує*', 'нахуй', 'пизд*', 'їба*', 'їбу', 'єба*', 'єбу', 'ебат*', 'бля', 'блять', 'блядь', 'бляд*', 'сука', 'суки',
    'сучка*', 'курва*', 'мудак*', 'мудил*', 'підор*', 'підар*', 'пидор*', 'лайно', 'гівно*', 'шльондр*', 'срака', 'гандон*',
    'довбойоб*', 'довбоєб*', 'мразь', 'виблядок*', 'покидьок*',
  ] },
  pl: { mode: 'word', words: [
    'kurwa*', 'kurwy', 'kurew*', 'chuj*', 'huj*', 'jeba*', 'jebi*', 'jebie*', 'jebn*', 'pierdol*', 'spierdal*', 'wypierdal*', 'zajeb*',
    'przejeb*', 'pojeb*', 'popierdol*', 'pizda*', 'pizdy', 'cipa*', 'skurwysyn*', 'skurwiel*', 'dziwka*', 'pedał*', 'pedal', 'cwel*',
    'gówno*', 'gowno*', 'dupek', 'kutas*', 'ja pierdolę', 'kurde', 'debil', 'frajer*',
  ] },
  nl: { mode: 'word', words: [
    'kut', 'kutten', 'kutwijf*', 'kutzooi', 'klootzak*', 'kankerlijer*', 'kankerhoer*', 'krijg de kanker', 'krijg de tering',
    'godverdomme', 'godverdomse', 'godver', 'tering*', 'teringlijer*', 'tyfuslijer*', 'tyfus op', 'hoer', 'hoeren*', 'hoerenzoon*',
    'lul', 'lullen', 'lulhannes', 'mongool*', 'flikker*', 'neuken', 'neuk', 'neukt', 'neuker*', 'pik', 'kanker op', 'sukkel',
    'kutmarokkaan*', 'sodemieter*',
  ] },
  sv: { mode: 'word', words: [
    'jävla*', 'jävlar', 'jävel', 'helvete', 'fitta*', 'fittan', 'kuk', 'kuken', 'kukhuvud*', 'hora', 'horan', 'horunge*', 'knulla*',
    'knull*', 'satans', 'skitstövel*', 'rövhål*', 'fan ta dig', 'dra åt helvete', 'bögjävel*', 'idiotjävel*',
  ] },
  no: { mode: 'word', words: [
    'faen', 'faens', 'faenskap', 'helvete', 'jævla*', 'jævel*', 'fitte*', 'fitta', 'kuk', 'kuken', 'kukhue*', 'hore*', 'hora',
    'knulle*', 'knull', 'pikk', 'pikken', 'drittsekk*', 'rasshøl*', 'dra til helvete', 'satan i helvete',
  ] },
  da: { mode: 'word', words: [
    'fanden', 'fandens', 'fandme', 'for helvede', 'helvede', 'kraftedeme', 'kneppe*', 'kneppet', 'kusse*', 'fisse*', 'pik', 'pikken',
    'pikhoved*', 'luder*', 'røvhul*', 'røvhuller', 'bøsserøv*', 'kælling*', 'skiderik*', 'pis og lort',
  ] },
  fi: { mode: 'word', words: [
    'vittu*', 'vitun', 'vitut', 'perkele*', 'saatana*', 'saatanan', 'helvetti*', 'helvetin', 'paska*', 'kusipää*', 'mulkku*', 'kyrpä*',
    'huora*', 'runkkari*', 'jumalauta', 'haista vittu', 'kusi*', 'mulkero*', 'nussi*',
  ] },
  cs: { mode: 'word', words: [
    'kurva*', 'kurev*', 'píča*', 'píči', 'čurák*', 'kokot*', 'hovno*', 'sračka*', 'zmrd*', 'mrdat*', 'mrdka*', 'prdel*', 'jebat*',
    'jebe*', 'děvka*', 'buzerant*', 'zkurvysyn*', 'do prdele', 'do píči', 'kurva drát', 'šukat*', 'zasraný*', 'posraný*',
  ] },
  ro: { mode: 'word', words: [
    'pula', 'pulă', 'pulii', 'pizda*', 'pizdă', 'pizdei', 'futu*', 'fute*', 'futut*', 'muie', 'muist*', 'căcat*', 'cacat*', 'curva*',
    'curvă', 'curve', 'târfă*', 'tarfa*', 'bulangiu*', 'poponar*', 'pizda mă-tii', 'mă-ta', 'ma-ta', 'sugi pula', 'coaie',
    'labagiu*', 'jegos*',
  ] },
  hu: { mode: 'word', words: [
    'kurva*', 'bazmeg', 'baszd meg', 'bassza meg', 'baszki', 'baszódj*', 'baszott*', 'basztam', 'baszni', 'basztad', 'fasz*',
    'lófasz', 'geci*', 'picsa*', 'pina', 'szar', 'szaros', 'szarházi', 'szarság', 'buzi', 'buzik', 'köcsög*', 'ribanc*',
    'kurvaanyád', 'seggfej*', 'segglyuk*', 'baromarcú', 'cigányozik', 'anyád picsája', 'kibaszott*',
  ] },
  el: { mode: 'word', words: [
    'γαμω*', 'γαμιεσαι', 'γαμησου', 'γαμημεν*', 'γαμιολ*', 'μαλακα*', 'μαλακας', 'μαλακισμεν*', 'πουτανα*', 'πουστη*', 'πουστης',
    'μουνι*', 'καριολη*', 'καριολης', 'αρχιδι*', 'σκατα', 'σκατο', 'σκατοφατσα', 'κωλοπαιδο*', 'κωλοφαρδ*', 'αντε γαμησου',
    'γαμω το', 'πουτανας γιε',
  ], accentFold: true },
  bg: { mode: 'word', words: [
    'курва*', 'путка*', 'путки', 'кур', 'кура', 'курът', 'еба', 'ебе', 'ебеш', 'ебан*', 'еби се', 'да ти еба', 'мамка ти', 'майка ти',
    'педал*', 'шибан*', 'лайно', 'лайна', 'копеле*', 'кучка*', 'гъз', 'мръсница',   ] },
  hi: { mode: 'word', words: [
    'चूतिया*', 'चुतिया*', 'चूत', 'चूतिये', 'भोसड़ी*', 'भोसडी*', 'भोसड़ा*', 'मादरचोद*', 'मादर चोद', 'बहनचोद*', 'बहन चोद', 'बहनचोद',
    'भेनचोद*', 'भैनचोद*', 'बेटीचोद*', 'गांडू*', 'गांड', 'गाँड', 'गाँडू*', 'लौड़ा*', 'लौडा*', 'लौड़े*', 'लंड*', 'रंडी*', 'हरामी*',
    'हरामज़ादा*', 'हरामजादा*', 'हरामज़ादे', 'कमीना*', 'कमीने', 'कुतिया', 'झाटू*', 'चोद*',
    'chutiya*', 'chutia*', 'madarchod*', 'behenchod*', 'bhenchod*', 'bhosdi*', 'bhosdike', 'gandu*', 'gaand', 'lund', 'lauda*',
    'lavda*', 'randi*', 'harami*', 'haramzada*', 'kamina*', 'kutiya', 'bc', 'mc', 'bsdk',
  ] },
  id: { mode: 'word', words: [
    'bangsat*', 'kontol*', 'memek*', 'ngentot*', 'entot*', 'ngewe*', 'jancuk*', 'jancok*', 'jancik', 'cuk', 'bajingan*', 'keparat*',
    'pepek*', 'lonte*', 'perek', 'bego lu', 'tai lu', 'tai kucing', 'asu', 'anjing lu', 'anjing kau', 'brengsek*', 'kampret*',
    'pantek*', 'pukimak*', 'puki',
  ] },
  vi: { mode: 'word', words: [
    'địt*', 'đụ', 'đụ má', 'đụ mẹ', 'đéo', 'đ.m', 'đm', 'dm', 'đmm', 'vcl', 'vkl', 'clgt', 'lồn', 'buồi', 'cặc', 'đĩ', 'con đĩ',
    'vãi lồn', 'vãi cặc', 'con mẹ mày', 'mẹ kiếp', 'đồ khốn', 'khốn nạn', 'chó chết', 'thằng chó', 'đồ chó', 'đù má',
  ] },
  th: { mode: 'sub', words: [
    'ควย', 'เย็ด', 'อีหี', 'หีแม่', 'เหี้ย', 'สัส', 'ไอ้สัตว์', 'อีสัตว์', 'ไอ้เหี้ย', 'อีเหี้ย', 'อีดอก', 'กะหรี่', 'ระยำ', 'ชาติหมา',
    'พ่อมึงตาย', 'แม่มึงตาย', 'ส้นตีน', 'ไอ้ควาย', 'อีควาย', 'เย็ดแม่', 'จัญไร', 'ตอแหล',
  ] },
  az: { mode: 'word', words: [
    'sik', 'sikim', 'sikin', 'sikərəm', 'sikerem', 'sikdir', 'siktir*', 'sikmək', 'amcıq*', 'amciq*', 'qəhbə*', 'qehbe*', 'peysər*',
    'peyser*', 'göt', 'götveren*', 'dalbayob*', 'dalbayok', 'gijdıllaq', 'blyat', 'suka', 'orospu*', 'qancıq*', 'qanciq*',
    'əclaf', 'eclaf', 'oğraş*', 'ograsi',
  ] },
  fa: { mode: 'word', words: [
    'کسکش', 'کس کش', 'کس‌کش', 'کس ننت', 'کس‌ننت', 'کسخل', 'کس خل', 'کس‌خل', 'کیر', 'کیری', 'کیرم', 'کیرت', 'کیر خر',
    'کون', 'کونی', 'کونکش', 'کون‌کش', 'کون کش', 'جنده', 'جنده‌ها', 'مادرجنده', 'مادر جنده', 'حرومزاده', 'حرامزاده', 'لاشی', 'گوه',
    'تخمی', 'جاکش', 'قرمساق', 'پدرسگ', 'پدر سگ', 'بی‌ناموس', 'بی ناموس', 'زنا زاده', 'ننه‌جنده',
  ] },
  ar: { mode: 'word', words: [
    'كس', 'كسمك', 'كس امك', 'كس أمك', 'كسختك', 'زب', 'زبي', 'زبك', 'نيك', 'نيكك', 'انيك', 'انيكك', 'منيوك', 'منيوكة', 'متناك',
    'متناكة', 'شرموط', 'شرموطة', 'شراميط', 'قحبة', 'قحاب', 'عرص', 'عرصة', 'معرص', 'خول', 'طيز', 'طيزك', 'يلعن أبوك', 'يلعن ابوك',
    'يلعن دينك', 'ابن الكلب', 'ابن كلب', 'ابن الحرام', 'ابن الشرموطة', 'ابن القحبة', 'كلب ابن كلب', 'منيك', 'لوطي',   ] },
  he: { mode: 'word', words: [
    'זונה', 'זונות', 'בן זונה', 'בת זונה', 'כוס אמא שלך', 'כוסאמק', 'כוס אמק', 'כוסית', 'זיין', 'זיינת', 'מזדיין', 'מזדיינת',
    'תזדיין', 'תזדייני', 'לזיין', 'חרא', 'יא חרא', 'מניאק', 'מניאקים', 'שרמוטה', 'שרמוטות', 'קוקסינל', 'זין שלי', 'על הזין',
    'אחושרמוטה', 'יבן זונה',
  ] },
  ja: { mode: 'sub', words: [
    'クソ', '糞', 'ちんこ', 'チンコ', 'ちんぽ', 'チンポ', 'まんこ', 'マンコ', 'おまんこ', 'オマンコ', 'ぶっ殺す', 'ぶっころす', '殺すぞ',
    'くたばれ', 'ファック', 'やりまん', 'ヤリマン', '売女', '淫売', 'ちくしょう', 'チクショウ', 'きちがい', 'キチガイ', '気違い',
    'くそったれ', 'クソッタレ', 'くそやろう', 'クソ野郎', '死ねよ', '死ねや', 'しねよ', 'ころすぞ', 'ビッチ',
  ] },
  ko: { mode: 'sub', words: [
    '씨발', '씨빨', '씨팔', '시발놈', '시발년', '씹새끼', '씹년', '씹창', '씹할', '좆', '좃같', '개새끼', '개새기', '개색기', '개자식', '병신',
    '븅신', '지랄', '미친놈', '미친년', '미친새끼', '썅', '니미', '니기미', '엿먹어', '존나', '좆나', '창녀', '화냥년', '호로새끼',
    '후레자식', '잡년', '쌍년', '쌍놈', '느금마', '애비없는', '닥쳐 씨',
  ] },
  'zh-CN': { mode: 'sub', words: [
    '他妈的', '你妈的', '妈的个', '操你', '草你妈', '艹你', '日你妈', '去你妈', '肏', '屄', '屌', '傻逼', '傻B', '傻屄', '煞笔', '沙比',
    '牛逼', '装逼', '逼样', '妈逼', '婊子', '贱人', '王八蛋', '混蛋', '狗娘养的', '鸡巴', '卧槽', '我操', '我草', '尼玛', '你妹的',
    '滚你妈', '狗日的', '贱货', '骚货', '杂种',
  ] },
  'zh-TW': { mode: 'sub', words: [
    '他媽的', '你媽的', '媽的個', '幹你娘', '幹你媽', '操你', '草你媽', '去你媽', '肏', '屄', '屌', '傻逼', '傻B', '婊子', '賤人',
    '王八蛋', '混蛋', '狗娘養的', '雞巴', '靠北', '靠杯', '機掰', '雞掰', '機歪', '臭機掰', '幹拎娘', '幹林娘', '賤貨', '騷貨',
    '雜種', '我操', '臥槽',
  ] },
};
