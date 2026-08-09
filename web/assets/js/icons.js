/* =========================================================
   Lika Ads — آیکون‌ها
   ---------------------------------------------------------
   آیکون‌های خطی و ساده (بدون ایموجی) که رنگشان را از متن
   اطرافشان می‌گیرند تا در تم روشن و تیره درست دیده شوند.
   ========================================================= */

window.Icons = (function () {
  const P = {
    /* ---------- نوار پایین ---------- */
    home: '<path d="M3 10.2 12 3l9 7.2V20a1 1 0 0 1-1 1h-5.2v-6.4H9.2V21H4a1 1 0 0 1-1-1z"/>',
    chart: '<path d="M3 21h18"/><path d="M6.5 21V11"/><path d="M12 21V4"/><path d="M17.5 21v-6.5"/>',
    chat: '<path d="M20.5 11.7a7.9 7.9 0 0 1-11.4 7.1L3.5 20.5l1.7-5.4a7.9 7.9 0 1 1 15.3-3.4z"/>',
    user: '<circle cx="12" cy="8" r="3.8"/><path d="M4.5 20.5a7.5 7.5 0 0 1 15 0"/>',

    /* ---------- مقصد تبلیغ ---------- */
    megaphone: '<path d="M4 9.5v4a1.5 1.5 0 0 0 1.5 1.5H8l6 4.5v-16L8 8.5H5.5A1.5 1.5 0 0 0 4 10z"/><path d="M17.5 8.8a4.5 4.5 0 0 1 0 6.4"/>',
    bot: '<rect x="4" y="8" width="16" height="12" rx="3"/><path d="M12 4.5V8"/><circle cx="12" cy="3.4" r="1.4"/><path d="M9 13v1.6"/><path d="M15 13v1.6"/>',
    link: '<path d="M10.2 13.8a4 4 0 0 0 5.7 0l2.9-2.9a4 4 0 0 0-5.7-5.7l-1.3 1.3"/><path d="M13.8 10.2a4 4 0 0 0-5.7 0l-2.9 2.9a4 4 0 0 0 5.7 5.7l1.3-1.3"/>',

    /* ---------- خدمات ---------- */
    send: '<path d="M21.5 2.5 11 13"/><path d="M21.5 2.5 15 21l-4-8-8-4z"/>',
    target: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1"/>',
    pulse: '<path d="M3 12h4l2.5-6 4 12L16 12h5"/>',

    /* ---------- عمومی ---------- */
    doc: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 13h6"/><path d="M9 17h4"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4 4"/>',
    plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    alert: '<path d="M12 3.5 21.5 20H2.5z"/><path d="M12 10v4"/><path d="M12 17.2v.1"/>',
    moon: '<path d="M20 13.5A8.2 8.2 0 0 1 10.5 4a8.5 8.5 0 1 0 9.5 9.5z"/>',
    sun: '<circle cx="12" cy="12" r="4.2"/><path d="M12 2.5V5"/><path d="M12 19v2.5"/><path d="M2.5 12H5"/><path d="M19 12h2.5"/><path d="M5.3 5.3 7 7"/><path d="M17 17l1.7 1.7"/><path d="M18.7 5.3 17 7"/><path d="M7 17l-1.7 1.7"/>',
    trash: '<path d="M4 7h16"/><path d="M9.5 7V4.8h5V7"/><path d="M6.5 7l1 12.2a2 2 0 0 0 2 1.8h5a2 2 0 0 0 2-1.8L17.5 7"/>',
    back: '<path d="M5 12h14"/><path d="M12 5l7 7-7 7"/>',
    next: '<path d="M19 12H5"/><path d="M12 19l-7-7 7-7"/>',
    inbox: '<path d="M3.5 13.5h4l1.5 3h6l1.5-3h4"/><path d="M5.6 5.2 3.5 13.5v3.8a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-3.8L18.4 5.2a2 2 0 0 0-1.8-1.2H7.4a2 2 0 0 0-1.8 1.2z"/>',
    folder: '<path d="M3.5 7.5a2 2 0 0 1 2-2h3.3l2 2.5h7.7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/>',
    help: '<circle cx="12" cy="12" r="8.5"/><path d="M9.7 9.5a2.4 2.4 0 1 1 3.2 2.3c-.6.2-.9.8-.9 1.4v.4"/><path d="M12 16.8v.1"/>',
    close: '<path d="M6 6l12 12"/><path d="M18 6 6 18"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 1.8"/>'
  };

  function icon(name, size) {
    const body = P[name];
    if (!body) return "";
    const s = size || 20;
    return (
      '<svg class="ic" width="' + s + '" height="' + s + '" viewBox="0 0 24 24" ' +
      'fill="none" stroke="currentColor" stroke-width="1.7" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      body +
      "</svg>"
    );
  }

  return { icon, has: (n) => Boolean(P[n]) };
})();
