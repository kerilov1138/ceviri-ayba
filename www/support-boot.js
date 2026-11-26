/*
 * CEVIRI_AYBARION - Canli destek: kimlik
 *
 * Sayfa acilirken kimin girdigini belirler. Uc kaynak (sirayla):
 *  1) Site, bu dosyadan ONCE window.AYBA_USER tanimlar (gercek kullanim):
 *       window.AYBA_USER = { role: 'member' | 'admin', firstName, lastName, company, id };
 *     Sitenin girisi yapilmis kullanicisi icin sunucu tarafinda yazilir.
 *  2) Ayni bilgi bir ust pencereden (site sayfasina gomulu iframe) postMessage ile gelir.
 *  3) Test girisi: yapilandirmada testLogin: true ise basit bir giris ekrani.
 * Yonetici ayrica yonetici parolasini girer (yonetici ekraninda).
 */
(function () {
  'use strict';
  var KEY = 'ayba_user';
  var cfg = window.AYBA_SUPPORT_CONFIG || {};

  function clean(u) {
    if (!u || typeof u !== 'object') return null;
    var role = u.role === 'admin' ? 'admin' : u.role === 'member' ? 'member' : '';
    var first = String(u.firstName || '').trim().slice(0, 60);
    var last = String(u.lastName || '').trim().slice(0, 60);
    if (!role || !first) return null;
    return {
      role: role,
      firstName: first,
      lastName: last,
      company: String(u.company || '').trim().slice(0, 120),
      id: String(u.id || '').slice(0, 64),
      test: Boolean(u.test),
    };
  }

  function stored() {
    try {
      return clean(JSON.parse(sessionStorage.getItem(KEY) || 'null'));
    } catch (e) {
      return null;
    }
  }

  var user = clean(window.AYBA_USER) || stored();
  window.AYBA_USER = user;
  // Kimlik yoksa uye gibi yuklenir; giris ekrani her seyi kapatir
  window.AYBA_ROLE = user ? user.role : 'member';
  window.AYBA_NEEDS_LOGIN = !user;

  window.AybaIdentity = {
    user: user,
    testLoginAllowed: cfg.testLogin === true,
    /** Test girisi / iframe'den gelen kimlik: kaydedip sayfayi yeniden acar. */
    set: function (u) {
      var c = clean(u);
      if (!c) return false;
      try {
        sessionStorage.setItem(KEY, JSON.stringify(c));
      } catch (e) {
        return false;
      }
      location.reload();
      return true;
    },
    signOut: function () {
      try {
        sessionStorage.removeItem(KEY);
        sessionStorage.removeItem('ayba_admin_pw');
      } catch (e) {
        /* yoksay */
      }
      location.reload();
    },
  };

  // Siteye iframe ile gomulduyse: ust sayfa kimligi gonderebilir
  var allowed = Array.isArray(cfg.parentOrigins) ? cfg.parentOrigins : [];
  window.addEventListener('message', function (e) {
    if (allowed.indexOf(e.origin) < 0) return;
    var d = e.data;
    if (!d || d.type !== 'ayba-user') return;
    var c = clean(d.user);
    if (!c) return;
    if (user && user.role === c.role && user.firstName === c.firstName && user.lastName === c.lastName && user.company === c.company) return;
    window.AybaIdentity.set(c);
  });
  if (window.parent !== window && allowed.length) {
    try {
      window.parent.postMessage({ type: 'ayba-ready' }, '*');
    } catch (e) {
      /* yoksay */
    }
  }
})();
