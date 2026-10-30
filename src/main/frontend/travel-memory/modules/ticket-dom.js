/**
 * 票根册的 DOM 节点：票夹、横向长串、护照、抽票、明信片、重走的全部元素。
 *
 * 从 ticket-gallery.js 拆出。脚本是 defer 的，模块顶层查询时 DOM 已就绪；
 * 这里只查询、不绑定事件，事件统一在 initTicketGallery / initTicketWallet 里绑。
 */

// ================= 票根墙 =================
// 票根是独立于足迹封面和图片墙的单图资源：一条足迹最多对应一张票根。
export const ticketGallery = document.getElementById('ticketGallery');
export const ticketGalleryBtn = document.getElementById('ticketGalleryBtn');
export const ticketGalleryBack = document.getElementById('ticketGalleryBack');
export const ticketGalleryEmpty = document.getElementById('ticketGalleryEmpty');
export const ticketGalleryStats = document.getElementById('ticketGalleryStats');
export const ticketLightbox = ticketGallery;
export const ticketWallet = document.getElementById('ticketWallet');
export const ticketGalleryHint = document.getElementById('ticketGalleryHint');
export const ticketStrip = document.getElementById('ticketStrip');
export const ticketStripScroller = document.getElementById('ticketStripScroller');
export const ticketStripProgress = document.getElementById('ticketStripProgress');
export const ticketStripHint = document.getElementById('ticketStripHint');
export const ticketMetaPanel = document.getElementById('ticketMetaPanel');
export const ticketLightboxLoading = document.getElementById('ticketGalleryLoading');
export const ticketLightboxError = document.getElementById('ticketGalleryError');
export const ticketLightboxTitle = document.getElementById('ticketGalleryTitle');
export const ticketLightboxPinyin = document.getElementById('ticketGalleryPinyin');
export const ticketLightboxEnglish = document.getElementById('ticketGalleryEnglish');
export const ticketLightboxSubtitle = document.getElementById('ticketGallerySubtitle');
export const ticketLightboxDetails = document.getElementById('ticketGalleryDetails');
export const ticketLightboxDescription = document.getElementById('ticketGalleryDescription');
export const ticketLightboxCount = document.getElementById('ticketGalleryPosition');
export const ticketLightboxRetry = document.getElementById('ticketGalleryRetry');
export const ticketPassportBtn = document.getElementById('ticketPassportBtn');
export const ticketPassportCount = document.getElementById('ticketPassportCount');
export const ticketPassport = document.getElementById('ticketPassport');
export const ticketPassportBack = document.getElementById('ticketPassportBack');
export const ticketPassportGrid = document.getElementById('ticketPassportGrid');
export const ticketPassportStats = document.getElementById('ticketPassportStats');
export const ticketPassportReset = document.getElementById('ticketPassportReset');
export const ticketStampBadge = document.getElementById('ticketStampBadge');
export const ticketOracleBtn = document.getElementById('ticketOracleBtn');
export const ticketOracle = document.getElementById('ticketOracle');
export const ticketOracleBack = document.getElementById('ticketOracleBack');
export const ticketOracleCard = document.getElementById('ticketOracleCard');
export const ticketOracleStats = document.getElementById('ticketOracleStats');
export const ticketOracleInspiration = document.getElementById('ticketOracleInspiration');
export const ticketOracleView = document.getElementById('ticketOracleView');
export const ticketOracleAgain = document.getElementById('ticketOracleAgain');
export const ticketOracleClose = document.getElementById('ticketOracleClose');
export const ticketLetterBtn = document.getElementById('ticketLetterBtn');
export const ticketLetter = document.getElementById('ticketLetter');
export const ticketLetterBack = document.getElementById('ticketLetterBack');
export const ticketLetterTitle = document.getElementById('ticketLetterTitle');
export const ticketLetterImg = document.getElementById('ticketLetterImg');
export const ticketLetterStage = document.getElementById('ticketLetterStage');
export const ticketLetterStatus = document.getElementById('ticketLetterStatus');
export const ticketLetterRetry = document.getElementById('ticketLetterRetry');
export const ticketLetterCaption = document.getElementById('ticketLetterCaption');
export const ticketLetterDownload = document.getElementById('ticketLetterDownload');
export const ticketLetterShare = document.getElementById('ticketLetterShare');
export const ticketViewModes = document.getElementById('ticketViewModes');
export const ticketCityFilterChip = document.getElementById('ticketCityFilter');
export const ticketModeArchiveBtn = document.getElementById('ticketModeArchiveBtn');
export const ticketModeReplayBtn = document.getElementById('ticketModeReplayBtn');
export const ticketReplayView = document.getElementById('ticketReplayView');
export const ticketReplayCard = document.getElementById('ticketReplayCard');
export const ticketReplaySubtitle = document.getElementById('ticketReplaySubtitle');
export const ticketReplayCityBadge = document.getElementById('ticketReplayCityBadge');
export const ticketReplayRoute = document.getElementById('ticketReplayRoute');
export const ticketReplayDistance = document.getElementById('ticketReplayDistance');
export const ticketReplayTotal = document.getElementById('ticketReplayTotal');
export const ticketReplayProgressText = document.getElementById('ticketReplayProgressText');
export const ticketReplayEta = document.getElementById('ticketReplayEta');
export const ticketReplayBarInner = document.getElementById('ticketReplayBarInner');
export const ticketReplayPrev = document.getElementById('ticketReplayPrev');
export const ticketReplayPlay = document.getElementById('ticketReplayPlay');
export const ticketReplayNext = document.getElementById('ticketReplayNext');
export const ticketReplayExit = document.getElementById('ticketReplayExit');
export const ticketReplaySpeed = document.getElementById('ticketReplaySpeed');
export const ticketReplayOpen = document.getElementById('ticketReplayOpen');
export const ticketReplayFlight = document.getElementById('ticketReplayFlight');
export const ticketReplayFlightLabel = document.getElementById('ticketReplayFlightLabel');
export const ticketReplayFlightFrom = document.getElementById('ticketReplayFlightFrom');
export const ticketReplayFlightCity = document.getElementById('ticketReplayFlightCity');
export const ticketReplayFlightKm = document.getElementById('ticketReplayFlightKm');
export const ticketReplayEnd = document.getElementById('ticketReplayEnd');
export const ticketReplayEndRange = document.getElementById('ticketReplayEndRange');
export const ticketReplayEndTickets = document.getElementById('ticketReplayEndTickets');
export const ticketReplayEndCities = document.getElementById('ticketReplayEndCities');
export const ticketReplayEndKm = document.getElementById('ticketReplayEndKm');
export const ticketReplayEndSpan = document.getElementById('ticketReplayEndSpan');
export const ticketReplayEndNote = document.getElementById('ticketReplayEndNote');
export const ticketReplayAgain = document.getElementById('ticketReplayAgain');
export const ticketReplayCloseEnd = document.getElementById('ticketReplayCloseEnd');
