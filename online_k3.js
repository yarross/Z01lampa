(function() {
  'use strict';

  // ===== ES5 polyfills for old devices (Tizen 2.x, WebOS 2.x, etc.) =====
  if (!Array.prototype.find) {
    Array.prototype.find = function(callback, thisArg) {
      for (var i = 0; i < this.length; i++) {
        if (callback.call(thisArg, this[i], i, this)) return this[i];
      }
      return undefined;
    };
  }
  if (!Array.prototype.findIndex) {
    Array.prototype.findIndex = function(callback, thisArg) {
      for (var i = 0; i < this.length; i++) {
        if (callback.call(thisArg, this[i], i, this)) return i;
      }
      return -1;
    };
  }
  if (!Array.prototype.includes) {
    Array.prototype.includes = function(val) {
      return this.indexOf(val) !== -1;
    };
  }
  if (!String.prototype.includes) {
    String.prototype.includes = function(val) {
      return this.indexOf(val) !== -1;
    };
  }
  if (!String.prototype.startsWith) {
    String.prototype.startsWith = function(s, pos) {
      pos = pos || 0;
      return this.indexOf(s, pos) === pos;
    };
  }
  if (!String.prototype.endsWith) {
    String.prototype.endsWith = function(s, len) {
      if (len === undefined || len > this.length) len = this.length;
      return this.substring(len - s.length, len) === s;
    };
  }
  if (typeof Promise === 'undefined') {
    // Minimal Promise polyfill for ES5 environments
    window.Promise = function(executor) {
      var self = this;
      self._state = 0; // 0=pending, 1=fulfilled, 2=rejected
      self._value = undefined;
      self._handlers = [];
      function resolve(val) {
        if (self._state !== 0) return;
        self._state = 1;
        self._value = val;
        self._handlers.forEach(function(h) { h.onFulfilled(val); });
      }
      function reject(val) {
        if (self._state !== 0) return;
        self._state = 2;
        self._value = val;
        self._handlers.forEach(function(h) { h.onRejected(val); });
      }
      try { executor(resolve, reject); } catch(e) { reject(e); }
    };
    window.Promise.prototype.then = function(onFulfilled, onRejected) {
      var self = this;
      return new Promise(function(resolve, reject) {
        function handle(onFn, fallback) {
          return function(val) {
            try {
              var result = (typeof onFn === 'function') ? onFn(val) : fallback(val);
              if (result && typeof result.then === 'function') result.then(resolve, reject);
              else resolve(result);
            } catch(e) { reject(e); }
          };
        }
        var handler = {
          onFulfilled: handle(onFulfilled, function(v) { return v; }),
          onRejected: handle(onRejected, function(e) { throw e; })
        };
        if (self._state === 1) setTimeout(function() { handler.onFulfilled(self._value); }, 0);
        else if (self._state === 2) setTimeout(function() { handler.onRejected(self._value); }, 0);
        else self._handlers.push(handler);
      });
    };
    window.Promise.prototype['catch'] = function(onRejected) {
      return this.then(null, onRejected);
    };
    window.Promise.resolve = function(val) { return new Promise(function(r) { r(val); }); };
    window.Promise.reject = function(val) { return new Promise(function(_, r) { r(val); }); };
  }
  // ===== /ES5 polyfills =====

  // ===== Random server selection (once per session) =====
  var YARROSS_SERVERS = [
    'http://s1.z01.online/',
    'http://s2.z01.online/',
    'http://s3.z01.online/'
  ];
  var YARROSS_FALLBACK = 'http://z01.online/';
  var YARROSS_PING_TIMEOUT = 1500; // мс — быстрый отсев неотвечающих серверов

  // «Пинг» через XMLHttpRequest с таймаутом (эндпоинт /t отдаёт статус 200)
  function yarrossPing(url, callback) {
    var xhr = new XMLHttpRequest();
    var done = false;

    function finish(ok) {
      if (done) return;
      done = true;
      callback(ok);
    }

    try {
      xhr.open('GET', url, true);
      xhr.timeout = YARROSS_PING_TIMEOUT;

      xhr.onload = function() {
        finish(xhr.status >= 200 && xhr.status < 400);
      };
      xhr.onerror = function() { finish(false); };
      xhr.ontimeout = function() { finish(false); };

      xhr.send();
    } catch (e) {
      finish(false);
    }
  }

  // Перемешивание (Fisher–Yates)
  function yarrossShuffle(arr) {
    var copy = arr.slice();
    for (var i = copy.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = copy[i];
      copy[i] = copy[j];
      copy[j] = tmp;
    }
    return copy;
  }

  // Выбор сервера: при каждой загрузке страницы, первый живой из случайного порядка
  function yarrossPickServer(callback) {
    var candidates = yarrossShuffle(YARROSS_SERVERS);

    function tryNext(index) {
      if (index >= candidates.length) {
        // никто не ответил — основной домен
        callback(YARROSS_FALLBACK);
        return;
      }
      yarrossPing(candidates[index], function(ok) {
        if (ok) {
          callback(candidates[index]);
        } else {
          tryNext(index + 1);
        }
      });
    }

    tryNext(0);
  }
  // ===== /Random server selection =====

  var Defined = {
    api: 'lampac',
    localhost: 'http://z01.online/',
    apn: ''
  };

  // Живой бесплатный сервер держим отдельно: он нужен и как запасной аэродром,
  // если премиум откажет.
  var YARROSS_FREE = YARROSS_FALLBACK;

  // Асинхронно подменяем localhost на выбранный сервер.
  // Если к этому моменту уже активирован премиум (zpremActivate поставил
  // prem.z01.online) — ничего не трогаем.
  yarrossPickServer(function(server) {
    YARROSS_FREE = server;
    if (Defined.localhost === YARROSS_FALLBACK) Defined.localhost = server;
  });

  // Премиум-сервер спрашивает аккаунт Лампы. Вышел человек из аккаунта — и
  // подписка есть, а толку нет: сервер отвечает accsdb. Вместо экрана «Нет
  // доступа» уходим на бесплатные серверы: там кино тоже есть.
  var zprem_dropped = false;

  function zpremDrop(er) {
    if (zprem_dropped) return false;
    if (!er || !er.accsdb) return false;
    if (Defined.localhost !== ZPREM_SERVER) return false;
    zprem_dropped = true;
    Defined.localhost = YARROSS_FREE;
    return true;
  }

  /**
   * Поиск по массиву без Array.prototype.find: его нет на Tizen 2.x и
   * WebOS 2.x, а на ещё не пришедшем ответе массив бывает пустым.
   */
  function arrFind(list, test) {
    if (!list) return undefined;
    for (var i = 0; i < list.length; i++) {
      if (test(list[i], i, list)) return list[i];
    }
    return undefined;
  }

  var balansers_with_search;
  
  var unic_id = Lampa.Storage.get('lampac_unic_id', '');
  if (!unic_id) {
    unic_id = Lampa.Utils.uid(8).toLowerCase();
    Lampa.Storage.set('lampac_unic_id', unic_id);
  }
  
    function getAndroidVersion() {
  if (Lampa.Platform.is('android')) {
    try {
      var current = AndroidJS.appVersion().split('-');
      return parseInt(current.pop());
    } catch (e) {
      return 0;
    }
  } else {
    return 0;
  }
}

var hostkey = 'https://z01.online'.replace('http://', '').replace('https://', '');

if (!window.rch_nws || !window.rch_nws[hostkey]) {
  if (!window.rch_nws) window.rch_nws = {};

  window.rch_nws[hostkey] = {
    type: Lampa.Platform.is('android') ? 'apk' : Lampa.Platform.is('tizen') ? 'cors' : undefined,
    startTypeInvoke: false,
    rchRegistry: false,
    apkVersion: getAndroidVersion()
  };
}

window.rch_nws[hostkey].typeInvoke = function rchtypeInvoke(host, call) {
  if (!window.rch_nws[hostkey].startTypeInvoke) {
    window.rch_nws[hostkey].startTypeInvoke = true;

    var check = function check(good) {
      window.rch_nws[hostkey].type = Lampa.Platform.is('android') ? 'apk' : good ? 'cors' : 'web';
      call();
    };

    if (Lampa.Platform.is('android') || Lampa.Platform.is('tizen')) check(true);
    else {
      var net = new Lampa.Reguest();
      net.silent('https://z01.online'.indexOf(location.host) >= 0 ? 'https://github.com/' : host + '/cors/check', function() {
        check(true);
      }, function() {
        check(false);
      }, false, {
        dataType: 'text'
      });
    }
  } else call();
};

window.rch_nws[hostkey].Registry = function RchRegistry(client, startConnection) {
  window.rch_nws[hostkey].typeInvoke('https://z01.online', function() {

    client.invoke("RchRegistry", {
      version: 154,
      host: location.host,
      rchtype: Lampa.Platform.is('android') ? 'apk' : Lampa.Platform.is('tizen') ? 'cors' : (window.rch_nws[hostkey].type || 'web'),
      apkVersion: window.rch_nws[hostkey].apkVersion,
      player: Lampa.Storage.field('player'),
	  account_email: Lampa.Storage.get('account_email', ''),
	  unic_id: Lampa.Storage.get('lampac_unic_id', ''),
	  profile_id: Lampa.Storage.get('lampac_profile_id', ''),
	  token: ''
    });

    if (client._shouldReconnect && window.rch_nws[hostkey].rchRegistry) {
      if (startConnection) startConnection();
      return;
    }

    window.rch_nws[hostkey].rchRegistry = true;

    client.on('RchRegistry', function(clientIp) {
      if (startConnection) startConnection();
    });

    client.on("RchClient", function(rchId, url, data, headers, returnHeaders) {
      var network = new Lampa.Reguest();

	  // Только scheme://host из WS URL этого клиента. WS у пользователей висит
	  // на /nws/, а POST-endpoints /rch/* смонтированы на root'е — split по /rch/
	  // не годится, оставляем именно origin (без пути).
	  var rchOrigin = (client && client.url)
	    ? client.url.replace(/^ws(s?):\/\/([^\/?#]+).*/, 'http$1://$2')
	    : 'https://z01.online';

	  function sendResult(uri, html) {
	    $.ajax({
	      url: rchOrigin + '/rch/' + uri + '?id=' + rchId,
	      type: 'POST',
	      data: html,
	      async: true,
	      cache: false,
	      contentType: false,
	      processData: false,
	      success: function(j) {},
	      error: function() {
	        client.invoke("RchResult", rchId, '');
	      }
	    });
	  }

      function result(html) {
        if (Lampa.Arrays.isObject(html) || Lampa.Arrays.isArray(html)) {
          html = JSON.stringify(html);
        }

        if (typeof CompressionStream !== 'undefined' && html && html.length > 2000) {
          var compressionStream = new CompressionStream('gzip');
          var encoder = new TextEncoder();
          var readable = new ReadableStream({
            start: function(controller) {
              controller.enqueue(encoder.encode(html));
              controller.close();
            }
          });
          var compressedStream = readable.pipeThrough(compressionStream);
          new Response(compressedStream).arrayBuffer()
            .then(function(compressedBuffer) {
              var compressedArray = new Uint8Array(compressedBuffer);
              if (compressedArray.length > html.length) {
                sendResult('result', html);
              } else {
                sendResult('gzresult', new Blob([compressedArray], { type: 'application/octet-stream' }));
              }
            })
            .catch(function() {
              sendResult('result', html);
            });

        } else {
          sendResult('result', html);
        }
      }

      if (url == 'eval') {
        console.log('RCH', url, data);
        result(eval(data));
      } else if (url == 'evalrun') {
        console.log('RCH', url, data);
        eval(data);
      } else if (url == 'ping') {
        result('pong');
      } else {
        console.log('RCH', url);
        network["native"](url, result, function(e) {
          console.log('RCH', 'result empty, ' + e.status);
          result('');
        }, data, {
          dataType: 'text',
          timeout: 1000 * 8,
          headers: headers,
          returnHeaders: returnHeaders
        });
      }
    });

    client.on('Connected', function(connectionId) {
      console.log('RCH', 'ConnectionId: ' + connectionId);
      window.rch_nws[hostkey].connectionId = connectionId;
    });
    client.on('Closed', function() {
      console.log('RCH', 'Connection closed');
    });
    client.on('Error', function(err) {
      console.log('RCH', 'error:', err);
    });
  });
};
  window.rch_nws[hostkey].typeInvoke('https://z01.online', function() {});

  function rchInvoke(json, call) {
    if (window.nwsClient && window.nwsClient[hostkey] && window.nwsClient[hostkey]._shouldReconnect){
      call();
      return;
    }
    if (!window.nwsClient) window.nwsClient = {};
    if (window.nwsClient[hostkey] && window.nwsClient[hostkey].socket)
      window.nwsClient[hostkey].socket.close();
    window.nwsClient[hostkey] = new NativeWsClient(json.nws, {
      autoReconnect: false
    });
    window.nwsClient[hostkey].on('Connected', function(connectionId) {
      window.rch_nws[hostkey].Registry(window.nwsClient[hostkey], function() {
        call();
      });
    });
    window.nwsClient[hostkey].connect();
  }

  function rchRun(json, call) {
    if (typeof NativeWsClient == 'undefined') {
      Lampa.Utils.putScript(["https://z01.online/js/nws-client-es5.js?v03022026"], function() {}, false, function() {
        rchInvoke(json, call);
      }, true);
    } else {
      rchInvoke(json, call);
    }
  }

  function account(url) {
    url = url + '';
    if (url.indexOf('account_email=') == -1) {
      var email = Lampa.Storage.get('account_email');
      if (email) url = Lampa.Utils.addUrlComponent(url, 'account_email=' + encodeURIComponent(email));
    }
    if (url.indexOf('uid=') == -1) {
      var uid = Lampa.Storage.get('lampac_unic_id', '');
      if (uid) url = Lampa.Utils.addUrlComponent(url, 'uid=' + encodeURIComponent(uid));
    }
    if (url.indexOf('token=') == -1) {
      var token = '';
      if (token != '') url = Lampa.Utils.addUrlComponent(url, 'token=');
    }
    if (url.indexOf('nws_id=') == -1 && window.rch_nws && window.rch_nws[hostkey]) {
      var nws_id = window.rch_nws[hostkey].connectionId || Lampa.Storage.get('lampac_nws_id', '');
      if (nws_id) url = Lampa.Utils.addUrlComponent(url, 'nws_id=' + encodeURIComponent(nws_id));
    }
    return url;
  }
  
  // Список балансеров меняется на сервере, а выбор сезона и перевода
  // синхронизируется по имени источника. Поэтому регистрируем сразу и
  // те, что пришли живьём: иначе у нового источника выбор не переезжает
  // между устройствами, пока имя не добавят в список руками.
  var synced_balansers = {};

  function syncBalanser(name) {
    if (!name || synced_balansers[name]) return;
    if (!Lampa.Manifest || Lampa.Manifest.app_digital < 177) return;
    if (!Lampa.Storage.sync) return;
    synced_balansers[name] = true;
    Lampa.Storage.sync('online_choice_' + name, 'object_object');
  }

  var Network = Lampa.Reguest;

  // Premium URLs — declared at top scope so component() can access them
  var ZPREM_SERVER = (Lampa.Utils && Lampa.Utils.protocol ? Lampa.Utils.protocol() : 'http://') + 'prem.z01.online/';
  var ZPREM_CHECK_URL = (Lampa.Utils && Lampa.Utils.protocol ? Lampa.Utils.protocol() : 'http://') + 'oplata.z01.online/check.php';
  var ZPREM_PAY_URL = 'https://oplata.z01.online/pay.php';
  var ZPREM_TRIAL_URL = (Lampa.Utils && Lampa.Utils.protocol ? Lampa.Utils.protocol() : 'http://') + 'oplata.z01.online/trial.php';

  // ==========================================================================
  //  Yarross UI — новый интерфейс онлайн-плагина
  //  Герой-блок с продолжением просмотра, ряды чипов (источник / сезон /
  //  озвучка) и список серий карточками. Всё управление вынесено на экран —
  //  скрытые фильтры больше не нужны.
  // ==========================================================================
  var YarrossUI = {};

  YarrossUI.enabled = function() {
    return Lampa.Storage.get('z01_ui_mode', 'modern') !== 'classic';
  };

  YarrossUI.REQUEST_TIMEOUT = 20000;  // сколько ждём ответ источника
  YarrossUI.WATCHDOG = 24;            // сторож обычного запроса, секунд
  YarrossUI.WATCHDOG_FIRST = 40;      // сторож первой загрузки, секунд

  YarrossUI.esc = function(str) {
    return (str === undefined || str === null ? '' : String(str))
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  };

  // --- Короткий значок качества: 1080p -> FHD ---
  YarrossUI.shortQuality = function(text) {
    if (!text) return '';
    text = String(text);
    var match = text.match(/(2160|1440|1080|720|576|480|360)\s*p?/i);
    if (match) {
      var value = parseInt(match[1]);
      if (value >= 2160) return '4K';
      if (value >= 1080) return 'FHD';
      if (value >= 720) return 'HD';
      return 'SD';
    }
    if (/4k|uhd/i.test(text)) return '4K';
    if (/fhd/i.test(text)) return 'FHD';
    if (/\bhd\b/i.test(text)) return 'HD';
    return '';
  };

  // --- Классификация озвучек ------------------------------------------------
  // Вместо плоской простыни из 15 кнопок сводим переводы к пяти понятным
  // категориям. Категория запоминается глобально: выбрал «Дубляж» — он же
  // подставится и на другом фильме, и на другом источнике.
  YarrossUI.VOICE_KINDS = [{
    key: 'dub',
    title: 'z01_voice_dub',
    re: /дубляж|дублирован|\bdub\b|\bdubbing\b/i
  }, {
    key: 'mvo',
    title: 'z01_voice_mvo',
    re: /многоголос|\bmvo\b|\bpmvo\b/i
  }, {
    key: 'dvo',
    title: 'z01_voice_dvo',
    re: /двухголос|\bdvo\b/i
  }, {
    key: 'avo',
    title: 'z01_voice_avo',
    re: /авторск|одноголос|\bavo\b|\bvo\b/i
  }, {
    key: 'orig',
    title: 'z01_voice_orig',
    re: /оригинал|original|\beng\b|\bua\b|\bukr\b/i
  }, {
    key: 'sub',
    title: 'z01_voice_sub',
    re: /субтитр|sub(title)?s?\b/i
  }];

  // Многие источники отдают только название студии, без слова «дубляж»
  // или «многоголосый» — разбираем такие по известным именам.
  YarrossUI.VOICE_STUDIOS = [{
    key: 'mvo',
    re: /lostfilm|лостфильм|tvshows|dniprofilm|невафильм|newstudio|newcomers|baibako|байбако|alexfilm|jaskier|coldfilm|колдфильм|hdrezka|rezkastudio|red head sound|sunshine|amedia|zakadry|закадры|linefilm|le-production|1win|kerob|profix|selena|октопус/i
  }, {
    key: 'dvo',
    re: /кубик в кубе|kubik|viruseproject|вирус|green ?tea|paradox/i
  }, {
    key: 'avo',
    re: /яроцк|гаврилов|володарск|сербин|горчаков|михал[её]в|живов|пучков|гоблин|кураж|дольск|есарев|карповск|визгунов/i
  }];

  YarrossUI.voiceKind = function(title) {
    var text = String(title || '');
    var i;
    for (i = 0; i < YarrossUI.VOICE_KINDS.length; i++) {
      if (YarrossUI.VOICE_KINDS[i].re.test(text)) return YarrossUI.VOICE_KINDS[i].key;
    }
    for (i = 0; i < YarrossUI.VOICE_STUDIOS.length; i++) {
      if (YarrossUI.VOICE_STUDIOS[i].re.test(text)) return YarrossUI.VOICE_STUDIOS[i].key;
    }
    return 'other';
  };

  YarrossUI.voiceKindTitle = function(key) {
    for (var i = 0; i < YarrossUI.VOICE_KINDS.length; i++) {
      if (YarrossUI.VOICE_KINDS[i].key == key) return Lampa.Lang.translate(YarrossUI.VOICE_KINDS[i].title);
    }
    return Lampa.Lang.translate('z01_voice_other');
  };

  /**
   * Группировка списка озвучек по категориям с сохранением исходных индексов.
   */
  YarrossUI.voiceGroups = function(list) {
    var order = [];
    var map = {};
    (list || []).forEach(function(entry, index) {
      var key = YarrossUI.voiceKind(entry.title);
      if (!map[key]) {
        map[key] = {
          key: key,
          title: YarrossUI.voiceKindTitle(key),
          items: []
        };
        order.push(key);
      }
      map[key].items.push({
        index: index,
        title: entry.title,
        url: entry.url
      });
    });
    // порядок категорий — как в VOICE_KINDS, остальное в конец
    var rank = function(key) {
      for (var i = 0; i < YarrossUI.VOICE_KINDS.length; i++) {
        if (YarrossUI.VOICE_KINDS[i].key == key) return i;
      }
      return 90;
    };
    order.sort(function(a, b) {
      return rank(a) - rank(b);
    });
    return order.map(function(key) {
      return map[key];
    });
  };

  /**
   * «HDVB ~ 1080p» -> имя «HDVB» + значок «FHD». Качество в названии
   * источника дублировать текстом незачем, оно читается значком.
   */
  YarrossUI.splitSourceName = function(name) {
    name = String(name || '');
    var badge = '';
    var match = name.match(/\s*[-~–]\s*(2160p?|1440p?|1080p?|720p?|480p?|4k|uhd|fhd|hd)\b[^,]*$/i);
    if (match) {
      badge = YarrossUI.shortQuality(match[1]);
      if (badge) name = name.slice(0, match.index);
    }
    return {
      name: name.replace(/\s+$/, ''),
      badge: badge
    };
  };

  /**
   * Часть источников отдаёт сезоны отдельной страницей, часть — кнопками
   * в одном ряду с переводами. Отличаем строго: только «2 сезон» или
   * «Season 2», чтобы не утащить озвучку вида «Дубляж (2 сезон)».
   */
  YarrossUI.isSeasonLabel = function(text) {
    text = String(text || '').trim();
    return /^\d+\s*(-?[йя])?\s*(сезон|season)$/i.test(text) || /^(сезон|season)\s*\d+$/i.test(text);
  };

  /**
   * Номер сезона из названия: «3 сезон», «Season 3», «Сезон 3» -> 3.
   * Нужен, чтобы переносить выбор между источниками — порядок и состав
   * списка у них разные, поэтому индекс не годится, а номер годится.
   */
  /**
   * Имя провайдера из ссылки: «/lite/cdnvideohub?s=1» -> «cdnvideohub».
   * Источник-агрегатор возвращает по набору сезонов от каждого провайдера,
   * и без подписи одинаковые «Сезон 1» выглядят как задвоение.
   */
  /**
   * Отдельные варианты источников имеют смысл только на фильмах: на
   * сериалах они отдают мусор или ту же раздачу. Прячем их у сериалов,
   * фильмов это не касается.
   */
  YarrossUI.MOVIE_ONLY = ['xvideocdnultra', 'xvideocdn60fps'];

  YarrossUI.isMovieOnlySource = function(key, title) {
    if (YarrossUI.MOVIE_ONLY.indexOf(String(key || '').toLowerCase()) !== -1) return true;
    return /^xvideocdn/i.test(key || '') && /ultra|60\s*\/?\s*120|60fps/i.test(title || '');
  };

  /**
   * Ссылка на оплату из ответа сервера. Лампак кладёт её по-разному:
   * отдельным полем или прямо в тексте сообщения.
   */
  YarrossUI.payLink = function(answer) {
    if (!answer) return '';
    var fields = ['url', 'link', 'pay', 'pay_url', 'payurl', 'buy', 'account'];
    for (var i = 0; i < fields.length; i++) {
      var value = answer[fields[i]];
      if (typeof value === 'string' && /^https?:\/\//i.test(value)) return value;
    }
    var text = String(answer.msg || answer.message || answer.text || '');
    var match = text.match(/https?:\/\/[^\s"'<>)]+/i);
    return match ? match[0] : '';
  };

  /**
   * Сервер отказывает по-разному: то accsdb с msg, то blocked с text
   * и кодом. Сводим к одному виду, чтобы показать причину, а не
   * «поиск не дал результатов».
   */
  YarrossUI.serverDenial = function(answer) {
    if (!answer || typeof answer !== 'object') return null;
    var denied = !!(answer.accsdb || answer.blocked || answer.error ||
      (typeof answer.code === 'number' && answer.code >= 300));
    if (!denied) return null;
    var text = String(answer.msg || answer.message || answer.text || '');
    // Сервер часто присылает готовую вёрстку со своим QR — второй
    // такой же рядом только путает.
    var own_image = /<img|qr-code|qrcode/i.test(text);
    return {
      msg: text || Lampa.Lang.translate('z01_no_access_text'),
      link: own_image ? '' : YarrossUI.payLink(answer)
    };
  };

  YarrossUI.qrImage = function(link, size) {
    size = size || 300;
    return 'https://api.qrserver.com/v1/create-qr-code/?size=' + size + 'x' + size +
      '&margin=10&data=' + encodeURIComponent(link);
  };

  YarrossUI.providerName = function(url) {
    var path = String(url || '').split('?')[0].split('#')[0];
    var parts = path.split('/');
    var last = '';
    while (parts.length && !last) last = parts.pop();
    return last;
  };

  YarrossUI.seasonNumber = function(title) {
    var match = String(title || '').match(/\d+/);
    return match ? parseInt(match[0]) : 0;
  };


  /**
   * Сравнение варианта из каталога с открытым фильмом. Часть источников
   * вместо серий отдаёт папку с десятком похожих названий — год и
   * оригинальное название позволяют выбрать нужное самим, а не заставлять
   * человека угадывать среди одинаковых строк.
   */
  YarrossUI.normName = function(text) {
    text = String(text === undefined || text === null ? '' : text).toLowerCase();
    text = text.replace(/\u0451/g, '\u0435').replace(/[^0-9a-z\u0430-\u044f]+/g, ' ');
    return text.replace(/^\s+/, '').replace(/\s+$/, '');
  };

  /**
   * Название вида «Обсессия / Obsession» — это два названия в одном,
   * поэтому сравниваем каждую половину отдельно.
   */
  YarrossUI.nameParts = function(text) {
    var raw = String(text || '').split(/\s*[\/|]\s*/);
    var out = [];
    for (var i = 0; i < raw.length; i++) {
      var norm = YarrossUI.normName(raw[i]);
      if (norm) out.push(norm);
    }
    return out;
  };

  YarrossUI.yearOf = function(value) {
    var match = String(value === undefined || value === null ? '' : value).match(/\d{4}/);
    var year = match ? parseInt(match[0], 10) : 0;
    return year > 1900 && year < 2200 ? year : 0;
  };

  YarrossUI.movieNames = function(movie) {
    var fields = ['title', 'name', 'original_title', 'original_name'];
    var out = [];
    for (var i = 0; i < fields.length; i++) {
      var parts = YarrossUI.nameParts(movie && movie[fields[i]]);
      for (var j = 0; j < parts.length; j++) {
        if (out.indexOf(parts[j]) === -1) out.push(parts[j]);
      }
    }
    return out;
  };

  /**
   * Насколько вариант похож на то, что открыл человек. Совпало название —
   * основной вес, год подтверждает или отбрасывает: у одного названия
   * бывает по несколько экранизаций разных лет.
   */
  YarrossUI.matchScore = function(elem, movie) {
    if (!elem || !movie) return 0;
    var mine = YarrossUI.movieNames(movie);
    var theirs = YarrossUI.nameParts(elem.title || elem.text || '');
    var score = 0;
    for (var i = 0; i < theirs.length; i++) {
      for (var j = 0; j < mine.length; j++) {
        var a = theirs[i];
        var b = mine[j];
        var hit = 0;
        if (a === b) hit = 60;
        else if (a.length > 3 && b.length > 3 && (a.indexOf(b) === 0 || b.indexOf(a) === 0)) hit = 34;
        else if (a.length > 5 && b.length > 5 && (a.indexOf(b) !== -1 || b.indexOf(a) !== -1)) hit = 22;
        if (hit > score) score = hit;
      }
    }
    var my_year = YarrossUI.yearOf(movie.release_date || movie.first_air_date || movie.year);
    var their_year = YarrossUI.yearOf(elem.year || elem.start_date);
    if (my_year && their_year) {
      var diff = Math.abs(my_year - their_year);
      // год премьеры у источников часто на год расходится с базой,
      // а вот разница в два года — это уже другой фильм
      if (diff === 0) score += 34;
      else if (diff === 1) score += 16;
      else score -= 30;
    }
    return score;
  };

  /**
   * Лучший вариант каталога: список, отсортированный по похожести, и
   * решение — можно ли открыть сразу или только подсветить.
   */
  YarrossUI.rankSimilars = function(list, movie) {
    var ranked = [];
    for (var i = 0; i < (list || []).length; i++) {
      ranked.push({
        elem: list[i],
        index: i,
        score: YarrossUI.matchScore(list[i], movie)
      });
    }
    ranked.sort(function(a, b) {
      return b.score - a.score || a.index - b.index;
    });
    var best = ranked[0];
    var second = ranked[1];
    var gap = best ? best.score - (second ? second.score : -100) : 0;
    return {
      list: ranked,
      best: best || null,
      // подсветить: похоже на наш фильм и заметно лучше остальных
      likely: !!(best && best.score >= 45 && gap >= 10),
      // открыть сразу: название совпало целиком и год не спорит
      sure: !!(best && best.score >= 70 && gap >= 25)
    };
  };

  /**
   * Серия считается просмотренной, если её отметили при запуске или
   * досмотрели до конца. Отметка привязана к озвучке, а тайм-код — нет,
   * поэтому серия, досмотренная в другом переводе или на другом
   * источнике, тоже попадает в счётчик.
   */
  YarrossUI.SEEN_PERCENT = 90;

  YarrossUI.isSeen = function(element, viewed) {
    if (!element) return false;
    if (element.hash_behold && viewed && viewed.indexOf(element.hash_behold) !== -1) return true;
    var line = element.timeline;
    return !!(line && line.percent >= YarrossUI.SEEN_PERCENT);
  };

  /**
   * Качество источника: подпись в названии («Filmix - 480p») говорит о
   * том, что настроено на сервере, а не о том, что реально приходит —
   * тот же filmix отдаёт 4K. Поэтому запоминаем, что источник отдавал
   * на самом деле, и по этому же значению его подписываем и сортируем.
   */
  YarrossUI.QUALITY_RANK = {
    '4K': 4,
    'FHD': 3,
    'HD': 2,
    'SD': 1
  };

  YarrossUI.qualityRank = function(label) {
    return YarrossUI.QUALITY_RANK[label] || 0;
  };

  /**
   * Докуда дошли по сериалу — независимо от источника и озвучки.
   * Отметка просмотра лежит внутри выбора конкретного балансера, а
   * человек смотрит сто серий на одном источнике, потом переключается
   * на другой, где когда-то посмотрел сороковую, — и список отматывался
   * назад. Здесь помним самую дальнюю серию сезона, и она не убывает.
   */
  YarrossUI.reachKey = function(movie) {
    if (!movie) return '';
    return Lampa.Utils.hash(movie.original_name || movie.original_title || movie.name || movie.title || '');
  };

  /**
   * Качество источника. Подпись в его названии — то, что настроено на
   * сервере, а не то, что приходит: filmix зовётся «480p», а отдаёт 4K,
   * у kinopub подписи нет вовсе. Поэтому запоминаем, что источник
   * действительно отдавал, когда мы у него были.
   */
  YarrossUI.bestQuality = function(items) {
    var best = '';
    for (var i = 0; i < (items || []).length; i++) {
      var item = items[i] || {};
      var label = '';
      var quality = item.quality || item.qualitys;
      if (quality && typeof quality === 'object') label = Lampa.Arrays.getKeys(quality).join(' ');
      else if (quality) label = String(quality);
      var found = YarrossUI.qualityFromText(label) || YarrossUI.qualityFromText(item.title || item.text || '');
      if (YarrossUI.qualityRank(found) > YarrossUI.qualityRank(best)) best = found;
    }
    return best;
  };

  YarrossUI.qualityFromText = function(text) {
    text = String(text === undefined || text === null ? '' : text);
    var best = '';
    var re = /(?:^|[^\d])(2160|1440|1080|720|576|480)\s*p?(?![\d])/gi;
    var found;
    while ((found = re.exec(text))) {
      var label = YarrossUI.shortQuality(found[1] + 'p');
      if (YarrossUI.qualityRank(label) > YarrossUI.qualityRank(best)) best = label;
    }
    if (/4k|uhd/i.test(text) && YarrossUI.qualityRank('4K') > YarrossUI.qualityRank(best)) best = '4K';
    if (!best && /fhd/i.test(text)) best = 'FHD';
    return best;
  };

  YarrossUI.knownQuality = function(name) {
    return Lampa.Storage.cache('z01_source_quality', 500, {})[name] || '';
  };

  YarrossUI.rememberQuality = function(name, label) {
    if (!name || !label) return;
    var all = Lampa.Storage.cache('z01_source_quality', 500, {});
    if (YarrossUI.qualityRank(label) <= YarrossUI.qualityRank(all[name])) return;
    all[name] = label;
    Lampa.Storage.set('z01_source_quality', all);
  };

  YarrossUI.sourceBadge = function(name, parts) {
    return YarrossUI.knownQuality(name) || (parts ? parts.badge : '');
  };

  YarrossUI.reachEntry = function(movie, season) {
    var all = Lampa.Storage.cache('z01_reach', 2000, {});
    var mine = all[YarrossUI.reachKey(movie)] || {};
    var value = mine[season || 1];
    if (typeof value === 'number') return {
      e: value,
      l: value,
      r: 2
    };
    if (value && typeof value === 'object') return {
      e: parseInt(value.e, 10) || 0,
      l: parseInt(value.l, 10) || 0,
      r: parseInt(value.r, 10) || 0
    };
    return {
      e: 0,
      l: 0,
      r: 0
    };
  };

  YarrossUI.reached = function(movie, season) {
    return YarrossUI.reachEntry(movie, season).e;
  };

  YarrossUI.setReach = function(movie, season, episode) {
    episode = parseInt(episode, 10) || 0;
    var key = YarrossUI.reachKey(movie);
    if (!key) return;
    var all = Lampa.Storage.cache('z01_reach', 2000, {});
    var mine = all[key] || {};
    mine[season || 1] = {
      e: episode,
      l: episode,
      r: episode ? 2 : 0
    };
    all[key] = mine;
    Lampa.Storage.set('z01_reach', all);
  };

  /**
   * Одна случайно открытая серия в конце не должна становиться местом,
   * куда плагин будет возвращать. Позицию двигает просмотр подряд.
   */
  YarrossUI.rememberReach = function(movie, season, episode) {
    episode = parseInt(episode, 10) || 0;
    var key = YarrossUI.reachKey(movie);
    if (!episode || !key) return;
    var entry = YarrossUI.reachEntry(movie, season);
    if (episode === entry.l || episode === entry.l + 1) entry.r = (entry.r || 0) + 1;
    else entry.r = 1;
    entry.l = episode;
    if (!entry.e || entry.r >= 2 || episode === entry.e + 1) entry.e = episode;
    var all = Lampa.Storage.cache('z01_reach', 2000, {});
    var mine = all[key] || {};
    mine[season || 1] = {
      e: entry.e,
      l: entry.l,
      r: entry.r
    };
    all[key] = mine;
    Lampa.Storage.set('z01_reach', all);
  };

  /**
   * Номер серии на кадре: ноль дописываем только однозначным, иначе
   * 161-я показывалась бы как «61».
   */
  YarrossUI.episodeNumber = function(value) {
    var num = parseInt(value, 10);
    if (!num && num !== 0) return String(value === undefined || value === null ? '' : value);
    return num < 10 ? '0' + num : String(num);
  };

  YarrossUI.icon = {
    play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"></path></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M4 12l5 5L20 6" stroke-linecap="round" stroke-linejoin="round"></path></svg>',
    chevron: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6"><path d="M6 9l6 6 6-6" stroke-linecap="round" stroke-linejoin="round"></path></svg>',
    search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="11" cy="11" r="7"></circle><path d="M20 20l-4-4" stroke-linecap="round"></path></svg>',
    refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M20 11a8 8 0 10-2.3 5.7" stroke-linecap="round"></path><path d="M20 4v7h-7" stroke-linecap="round" stroke-linejoin="round"></path></svg>',
    warn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 4l9 16H3z" stroke-linejoin="round"></path><path d="M12 10v4" stroke-linecap="round"></path><circle cx="12" cy="17" r="0.6" fill="currentColor"></circle></svg>'
  };

  YarrossUI.css = [
    '<style>',
    '.mo{padding:0 0 3em 0}',
    '.mo *{-webkit-box-sizing:border-box;box-sizing:border-box}',

    /* --- шапка: что смотрим и сколько осталось --- */
    '.mo-head{display:-webkit-box;display:-webkit-flex;display:-ms-flexbox;display:flex;-webkit-box-align:center;-webkit-align-items:center;-ms-flex-align:center;align-items:center;padding:0 .2em .7em .2em}',
    '.mo-head__art{position:relative;width:4.6em;height:6.6em;-webkit-flex-shrink:0;-ms-flex-negative:0;flex-shrink:0;margin-right:1.1em;background:rgba(255,255,255,.07);-webkit-border-radius:.35em;border-radius:.35em;overflow:hidden}',
    '.mo-head__art img{position:absolute;top:0;left:0;width:100%;height:100%;-o-object-fit:cover;object-fit:cover;opacity:0;-webkit-transition:opacity .3s;transition:opacity .3s}',
    '.mo-head__art--loaded img{opacity:1}',
    '.mo-head__text{-webkit-box-flex:1;-webkit-flex:1 1 auto;-ms-flex:1 1 auto;flex:1 1 auto;min-width:0;padding-right:1em}',
    '.mo-head__sub{font-size:1em;opacity:.45;line-height:1.3;overflow:hidden;white-space:nowrap;-o-text-overflow:ellipsis;text-overflow:ellipsis}',
    '.mo-head__title{font-size:1.7em;font-weight:600;line-height:1.2;overflow:hidden;white-space:nowrap;-o-text-overflow:ellipsis;text-overflow:ellipsis}',
    '.mo-head__note{font-size:1.05em;opacity:.7;white-space:nowrap;padding-bottom:.15em}',
    '.mo-head__bar{position:relative;height:.25em;-webkit-border-radius:.25em;border-radius:.25em;background:rgba(255,255,255,.12);margin:0 .2em 1.4em .2em;overflow:hidden}',
    '.mo-head__fill{position:absolute;left:0;top:0;bottom:0;background:#7cc4ff}',
    '.mo-head--hidden{display:none}',

    /* --- панель выбора --- */
    '.mo-panel{display:-webkit-box;display:-webkit-flex;display:-ms-flexbox;display:flex;-webkit-flex-wrap:wrap;-ms-flex-wrap:wrap;flex-wrap:wrap;margin:0 0 1.3em 0}',
    '.mo-seg{position:relative;min-width:11em;max-width:24em;padding:.6em 2.2em .6em 1em;margin:0 .8em .6em 0;background:rgba(255,255,255,.08);-webkit-border-radius:.35em;border-radius:.35em;line-height:1.25}',
    '.mo-seg__name{font-size:.75em;letter-spacing:.06em;text-transform:uppercase;opacity:.5}',
    '.mo-seg__value{font-size:1.15em;overflow:hidden;white-space:nowrap;-o-text-overflow:ellipsis;text-overflow:ellipsis}',
    '.mo-seg__mark{font-size:.68em;font-weight:600;padding:.1em .4em;margin-right:.5em;background:rgba(255,255,255,.2);-webkit-border-radius:.25em;border-radius:.25em;vertical-align:.15em}',
    '.mo-seg__arrow{position:absolute;right:.9em;top:50%;margin-top:-.2em;width:0;height:0;border-left:.4em solid transparent;border-right:.4em solid transparent;border-top:.45em solid rgba(255,255,255,.55)}',
    '.mo-seg.focus{background:#fff;color:#000}',
    '.mo-seg.focus .mo-seg__name{opacity:.6}',
    '.mo-seg.focus .mo-seg__mark{background:rgba(0,0,0,.15)}',
    '.mo-seg.focus .mo-seg__arrow{border-top-color:rgba(0,0,0,.6)}',
    '.mo-seg--open{background:rgba(124,196,255,.22)}',

    /* --- раскрытый список: плитки в несколько колонок --- */
    '.mo-grid{display:-webkit-box;display:-webkit-flex;display:-ms-flexbox;display:flex;-webkit-flex-wrap:wrap;-ms-flex-wrap:wrap;flex-wrap:wrap;margin:0 -.3em 1.4em -.3em}',
    '.mo-opt{width:25%;padding:0 .3em .6em .3em}',
    '.mo-opt__in{position:relative;padding:.65em .8em;min-height:3.1em;background:rgba(255,255,255,.07);-webkit-border-radius:.35em;border-radius:.35em;line-height:1.3;overflow:hidden}',
    '.mo-opt__label{display:block;overflow:hidden;white-space:nowrap;-o-text-overflow:ellipsis;text-overflow:ellipsis}',
    '.mo-opt__note{display:block;font-size:.8em;opacity:.5;overflow:hidden;white-space:nowrap;-o-text-overflow:ellipsis;text-overflow:ellipsis}',
    '.mo-opt.focus .mo-opt__in{background:#fff;color:#000}',
    '.mo-opt.focus .mo-opt__note{opacity:.6}',
    '.mo-opt--active .mo-opt__in{-webkit-box-shadow:inset 0 0 0 .12em #7cc4ff;box-shadow:inset 0 0 0 .12em #7cc4ff}',
    '.mo-opt__tag{display:inline-block;min-width:2.4em;text-align:center;font-size:.7em;font-weight:600;background:rgba(255,255,255,.18);-webkit-border-radius:.25em;border-radius:.25em;padding:.1em .3em;margin-right:.5em;vertical-align:.15em}',
    '.mo-opt.focus .mo-opt__tag{background:rgba(0,0,0,.14)}',

    /* --- серии плитками --- */
    '.mo-tiles{display:-webkit-box;display:-webkit-flex;display:-ms-flexbox;display:flex;-webkit-flex-wrap:wrap;-ms-flex-wrap:wrap;flex-wrap:wrap;margin:0 -.45em}',
    '.mo-tile{width:25%;padding:0 .45em 1.1em .45em}',
    '.mo-tile__art{position:relative;padding-top:56%;background:rgba(255,255,255,.08);-webkit-border-radius:.4em;border-radius:.4em;overflow:hidden}',
    '.mo-tile__art img{position:absolute;top:0;left:0;width:100%;height:100%;-o-object-fit:cover;object-fit:cover;opacity:0;-webkit-transition:opacity .3s;transition:opacity .3s}',
    '.mo-tile__art--loaded img{opacity:1}',
    '.mo-tile__num{position:absolute;left:.5em;top:.45em;font-size:1.1em;font-weight:700;padding:.05em .45em;background:rgba(0,0,0,.55);-webkit-border-radius:.25em;border-radius:.25em}',
    '.mo-tile__tag{position:absolute;right:.5em;top:.45em;font-size:.72em;font-weight:600;padding:.15em .4em;background:rgba(0,0,0,.55);-webkit-border-radius:.25em;border-radius:.25em}',
    '.mo-tile__time{position:absolute;right:.5em;bottom:.5em;font-size:.8em;padding:.1em .4em;background:rgba(0,0,0,.55);-webkit-border-radius:.25em;border-radius:.25em}',
    '.mo-tile__check{position:absolute;left:.5em;bottom:.5em;width:1.5em;height:1.5em;padding:.25em;color:#0b0c12;background:#7bd88f;-webkit-border-radius:100%;border-radius:100%}',
    '.mo-tile__check svg{width:100%;height:100%}',
    '.mo-tile__line{position:absolute;left:0;right:0;bottom:0;height:.25em}',
    '.mo-tile__line .time-line{display:block !important;height:100%;margin:0;background:rgba(0,0,0,.5)}',
    '.mo-tile__line .time-line>div{background:#7cc4ff}',
    '.mo-tile__body{padding:.5em .15em 0 .15em}',
    '.mo-tile__title{font-size:1.05em;line-height:1.35;overflow:hidden;white-space:nowrap;-o-text-overflow:ellipsis;text-overflow:ellipsis}',
    '.mo-tile__meta{font-size:.85em;opacity:.5;line-height:1.4;overflow:hidden;white-space:nowrap;-o-text-overflow:ellipsis;text-overflow:ellipsis}',
    '.mo-tile__meta span+span:before{content:" · "}',
    '.mo-tile--seen .mo-tile__art img{opacity:.45}',
    '.mo-tile--seen .mo-tile__title{opacity:.6}',
    '.mo-tile.focus .mo-tile__art{-webkit-box-shadow:0 0 0 .2em #fff;box-shadow:0 0 0 .2em #fff}',
    '.mo-tile--current .mo-tile__art{-webkit-box-shadow:0 0 0 .16em #7cc4ff;box-shadow:0 0 0 .16em #7cc4ff}',
    '.mo-tile.focus.mo-tile--current .mo-tile__art{-webkit-box-shadow:0 0 0 .2em #fff;box-shadow:0 0 0 .2em #fff}',
    '.mo-tile--soon{opacity:.45}',

    /* --- переводы фильма и переходы: строкой --- */
    '.mo-line{position:relative;display:-webkit-box;display:-webkit-flex;display:-ms-flexbox;display:flex;-webkit-box-align:center;-webkit-align-items:center;-ms-flex-align:center;align-items:center;padding:.6em 1em .65em .6em;margin-bottom:.45em;background:rgba(255,255,255,.06);-webkit-border-radius:.4em;border-radius:.4em}',
    '.mo-line__art{position:relative;width:4.4em;height:4.4em;-webkit-flex-shrink:0;-ms-flex-negative:0;flex-shrink:0;margin-right:1em;background:rgba(255,255,255,.08);-webkit-border-radius:.3em;border-radius:.3em;overflow:hidden}',
    '.mo-line__art img{position:absolute;top:0;left:0;width:100%;height:100%;-o-object-fit:cover;object-fit:cover;opacity:0;-webkit-transition:opacity .3s;transition:opacity .3s}',
    '.mo-line__art--loaded img{opacity:1}',


    '.mo-line__time{font-size:.9em;opacity:.6;margin-left:.7em}',
    '.mo-line__line{position:absolute;left:6.2em;right:1em;bottom:.35em;height:.16em}',
    '.mo-line__line .time-line{display:block !important;height:100%;margin:0;background:rgba(255,255,255,.14);-webkit-border-radius:.16em;border-radius:.16em;overflow:hidden}',
    '.mo-line__line .time-line>div{background:#7cc4ff}',
    '.mo-line.focus .mo-line__line .time-line{background:rgba(0,0,0,.15)}',
    '.mo-line.focus{background:#fff;color:#000}',
    '.mo-line--current{-webkit-box-shadow:inset .18em 0 0 #7cc4ff;box-shadow:inset .18em 0 0 #7cc4ff}',
    '.mo-line__tag{font-size:.72em;font-weight:600;background:rgba(255,255,255,.18);-webkit-border-radius:.25em;border-radius:.25em;padding:.15em .45em;margin-left:.7em}',
    '.mo-line.focus .mo-line__tag{background:rgba(0,0,0,.14)}',
    '.mo-line__body{-webkit-box-flex:1;-webkit-flex:1 1 auto;-ms-flex:1 1 auto;flex:1 1 auto;min-width:0}',
    '.mo-line__title{font-size:1.15em;line-height:1.35;overflow:hidden;white-space:nowrap;-o-text-overflow:ellipsis;text-overflow:ellipsis}',
    '.mo-line__note{font-size:.85em;opacity:.55;line-height:1.4;overflow:hidden;white-space:nowrap;-o-text-overflow:ellipsis;text-overflow:ellipsis}',
    '.mo-line__side{display:-webkit-box;display:-webkit-flex;display:-ms-flexbox;display:flex;-webkit-box-align:center;-webkit-align-items:center;-ms-flex-align:center;align-items:center;-webkit-flex-shrink:0;-ms-flex-negative:0;flex-shrink:0;padding-left:1em}',
    '.mo-line--nav .mo-line__side:after{content:"›";font-size:1.5em;opacity:.6}',

    /* --- служебные экраны --- */
    '.mo-info{padding:1.4em .2em}',
    '.mo-info__title{font-size:1.5em;font-weight:600;margin-bottom:.4em}',
    '.mo-info__text{font-size:1.05em;line-height:1.5;opacity:.7;margin-bottom:1.1em;max-width:44em}',
    '.mo-info__text img{max-width:12em;margin-top:.8em;display:block}',
    '.mo-info__link{font-size:.95em;opacity:.5;word-break:break-all;margin-bottom:1em}',
    '.mo-info__qr{margin-bottom:1.1em}',
    '.mo-info__qr img{display:block;width:11em;height:11em;background:#fff;padding:.4em;-webkit-border-radius:.4em;border-radius:.4em}',
    '.mo-info__acts{display:-webkit-box;display:-webkit-flex;display:-ms-flexbox;display:flex;-webkit-flex-wrap:wrap;-ms-flex-wrap:wrap;flex-wrap:wrap}',
    '.mo-act{padding:.6em 1.4em;margin:0 .8em .6em 0;background:rgba(255,255,255,.12);-webkit-border-radius:.35em;border-radius:.35em;font-size:1.05em;white-space:nowrap}',
    '.mo-act.focus{background:#fff;color:#000}',
    '.mo-act>svg{width:1.1em;height:1.1em;margin-right:.5em;vertical-align:-.15em}',

    /* --- загрузка --- */
    '.mo-wait{width:100%;padding:.2em .2em 1.2em .2em}',
    '.mo-wait__head{display:-webkit-box;display:-webkit-flex;display:-ms-flexbox;display:flex;-webkit-box-align:baseline;-webkit-align-items:baseline;-ms-flex-align:baseline;align-items:baseline;margin-bottom:.5em}',
    '.mo-wait__title{font-size:1.25em;padding-right:.8em;-webkit-box-flex:1;-webkit-flex:1 1 auto;-ms-flex:1 1 auto;flex:1 1 auto}',
    '.mo-wait__count{font-size:.95em;opacity:.55}',
    '.mo-wait__bar{position:relative;height:.25em;width:100%;max-width:24em;-webkit-border-radius:.25em;border-radius:.25em;background:rgba(255,255,255,.12);overflow:hidden}',
    '.mo-wait__fill{position:absolute;left:0;top:0;bottom:0;background:#7cc4ff;-webkit-transition:width .4s;transition:width .4s}',

    '@media screen and (max-width:1300px){',
    '.mo-opt{width:33.333%}',
    '.mo-tile{width:33.333%}',
    '}',
    '@media screen and (max-width:900px){',
    '.mo-opt{width:50%}',
    '.mo-tile{width:50%}',
    '.mo-head__title{font-size:1.4em}',
    '}',
    '@media screen and (max-width:580px){',
    '.mo-opt{width:100%}',
    '.mo-seg{min-width:8em}',
    '}',
    '</style>'
  ].join('');

  function component(object) {
    var network = new Network();
    var scroll = new Lampa.Scroll({
      mask: true,
      over: true
    });
    var files = new Lampa.Explorer(object);
    var filter = new Lampa.Filter(object);
    var sources = {};
    var last;
    var source;
    var balanser;
    var initialized;
    var balanser_timer;
    var images = [];
    var number_of_requests = 0;
    var number_of_requests_timer;
    var life_wait_times = 0;
    var life_wait_timer;
    var filter_sources = {};
    var filter_translate = {
      season: Lampa.Lang.translate('torrent_serial_season'),
      voice: Lampa.Lang.translate('torrent_parser_voice'),
      source: Lampa.Lang.translate('settings_rest_source')
    };
    var filter_find = {
      season: [],
      voice: []
    };
	
    if (balansers_with_search == undefined) {
      network.timeout(10000);
      network.silent(account('https://z01.online/lite/withsearch'), function(json) {
        balansers_with_search = json;
      }, function() {
		  balansers_with_search = [];
	  });
    }
	
    function balanserName(j) {
      var bals = j.balanser;
      var name = j.name.split(' ')[0];
      return (bals || name).toLowerCase();
    }
	
	function clarificationSearchAdd(value){
		var id = Lampa.Utils.hash(object.movie.number_of_seasons ? object.movie.original_name : object.movie.original_title);
		var all = Lampa.Storage.get('clarification_search','{}');
		
		all[id] = value;
		
		Lampa.Storage.set('clarification_search',all);
	}
	
	function clarificationSearchDelete(){
		var id = Lampa.Utils.hash(object.movie.number_of_seasons ? object.movie.original_name : object.movie.original_title);
		var all = Lampa.Storage.get('clarification_search','{}');
		
		delete all[id];
		
		Lampa.Storage.set('clarification_search',all);
	}
	
	function clarificationSearchGet(){
		var id = Lampa.Utils.hash(object.movie.number_of_seasons ? object.movie.original_name : object.movie.original_title);
		var all = Lampa.Storage.get('clarification_search','{}');
		
		return all[id];
	}

    // ======================================================================
    //  Yarross UI v2 — состояние и отрисовка
    // ======================================================================
    var modern = YarrossUI.enabled();
    var ui = {};          // узлы интерфейса
    var ui_items = [];    // текущий список файлов
    var ui_enter = null;  // обработчик запуска файла
    var ui_focus = '';       // куда вернуть фокус после перерисовки
    var ui_tried = {};       // источники, уже опробованные в этом заходе
    var ui_open = '';        // какой список раскрыт: source | season | voice
    var ui_nav = false;      // список — это переходы по сезонам, а не серии
    var season_pinned = false; // запомненный сезон применяем один раз на источник
    var similar_list = null;   // каталог вариантов, если источник отдал папку
    var similar_auto = false;  // подходящий вариант уже открыли сами
    var similar_shown = false; // на экране сейчас сам каталог
    var last_origin = '';    // сервер, который отдал последний ответ
    var request_gen = 0;     // поколение запроса: ответы прошлых игнорируем
    var ui_watchdog;         // сторож: не даём зависнуть на загрузке
    var ui_load_timer;       // тикер индикатора загрузки
    var ui_load_started = 0;
    var ui_load_found = 0;
    var ui_load_percent = 0;
    var ui_load_simple = false;

    /**
     * Каркас интерфейса. Строится один раз, дальше обновляются только части,
     * поэтому переключение озвучки/сезона не «моргает» всей страницей.
     */
    this.uiFrame = function() {
      if (!ui.root) {
        ui.root = $('<div class="mo"></div>');
        ui.status = $('<div class="mo__status"></div>');
        ui.panel = $('<div class="mo__panel"></div>');
        ui.list = $('<div class="mo-list"></div>');
        ui.root.append(ui.status).append(ui.panel).append(ui.list);
      }
      if (!ui.root.parent().length) {
        scroll.clear();
        scroll.append(ui.root);
      }
      return ui.root;
    };

    /**
     * Строка подгрузки: заголовок, счётчик секунд и полоса. Заменила
     * серые плитки-заготовки — они на узком экране схлопывались в
     * несколько чёрточек, и было непонятно, работает плагин или завис.
     */
    this.uiWaitBox = function(title) {
      var box = $('<div class="mo-wait">' +
        '<div class="mo-wait__head"><div class="mo-wait__title"></div><div class="mo-wait__count"></div></div>' +
        '<div class="mo-wait__bar"><div class="mo-wait__fill"></div></div>' +
        '</div>');
      box.find('.mo-wait__title').text(title);
      return box;
    };

    /**
     * Пока список грузится, в шапке должен стоять тот сезон, который грузим.
     * Иначе видно «Сезон 2» над панелью, где выбран третий.
     */
    this.uiStatusPending = function() {
      if (!ui.status) return;
      var box = ui.status.empty().removeClass('mo-head--hidden');
      if (ui_nav || !object.movie.name) return box.addClass('mo-head--hidden');
      var seasons = filter_find.season || [];
      if (!seasons.length) return box.addClass('mo-head--hidden');
      var choice = this.getChoice();
      var title = (seasons[choice.season] || seasons[0]).title || '';
      if (!title) return box.addClass('mo-head--hidden');
      var head = $('<div class="mo-head"><div class="mo-head__text"><div class="mo-head__title"></div></div></div>');
      head.find('.mo-head__title').text(title);
      box.append(head);
    };

    this.uiWaitStart = function(title, simple) {
      var _this = this;
      this.uiStatusPending();
      ui_load_started = Date.now();
      ui_load_found = 0;
      ui_load_percent = 0;
      ui_load_simple = !!simple;
      ui.load = this.uiWaitBox(title);
      ui.list.empty().append(ui.load);
      this.uiLoadingText();
      clearInterval(ui_load_timer);
      ui_load_timer = setInterval(function() {
        _this.uiLoadingText();
      }, 1000);
    };

    /**
     * Первая загрузка идёт секундами: без счётчика непонятно, ищет
     * плагин или сервер уснул.
     */
    this.uiLoadingPanel = function() {
      this.uiFrame();
      this.uiWatch(YarrossUI.WATCHDOG_FIRST);
      this.uiWaitStart(Lampa.Lang.translate('z01_loading_title'), false);
    };

    this.uiLoadingText = function() {
      if (!ui.load || !ui.load.parent().length) return this.uiLoadingStop();
      var seconds = Math.max(0, Math.round((Date.now() - ui_load_started) / 1000));
      var text = '';
      if (!ui_load_simple) {
        text = ui_load_found ?
          Lampa.Lang.translate('z01_loading_found').replace('{n}', ui_load_found) :
          Lampa.Lang.translate('z01_loading_start');
        text += ' · ';
      }
      text += seconds + Lampa.Lang.translate('z01_sec');
      if (seconds >= 12 && ui_load_percent < 100) text += ' · ' + Lampa.Lang.translate('z01_loading_slow');
      ui.load.find('.mo-wait__count').text(text);
      var percent = Math.max(ui_load_percent, Math.min(90, seconds * 7));
      ui.load.find('.mo-wait__fill').css('width', percent + '%');
    };

    this.uiLoadingProgress = function(json, times) {
      if (!ui.load || !ui.load.parent().length) return;
      var list = (json && json.online) || [];
      var found = 0;
      list.forEach(function(item) {
        if (item.show) found++;
      });
      ui_load_found = found;
      ui_load_percent = json && json.ready ? 100 : Math.min(95, Math.round((times / 15) * 100));
      this.uiWatch(YarrossUI.WATCHDOG_FIRST);
      this.uiLoadingText();
    };

    this.uiLoadingStop = function() {
      clearInterval(ui_load_timer);
      ui_load_timer = null;
      ui.load = null;
    };

    /**
     * Сторож загрузки: источник может молчать сколько угодно, а человек
     * должен видеть выход, а не крутилку.
     */
    this.uiWatch = function(seconds) {
      var _this = this;
      clearTimeout(ui_watchdog);
      if (!modern) return;
      ui_watchdog = setTimeout(function() {
        if (Lampa.Activity.active().activity !== _this.activity) return;
        network.clear();
        _this.doesNotAnswer({
          timeout: true
        });
      }, (seconds || YarrossUI.WATCHDOG) * 1000);
    };

    this.uiWatchStop = function() {
      clearTimeout(ui_watchdog);
      ui_watchdog = null;
    };

    this.uiLoading = function() {
      this.uiFrame();
      this.uiLoadingStop();
      this.uiWatch();
      request_gen++;
      network.clear();
      clearInterval(balanser_timer);
      this.clearImages();
      this.uiWaitStart(Lampa.Lang.translate('z01_loading_list'), true);
      this.activity.loader(false);
      this.activity.toggle();
    };

    this.uiFocusTarget = function() {
      return last;
    };

    this.uiFocusRestore = function(fallback) {
      var element = false;
      if (ui_focus && ui.root) {
        var found = ui.root.find('[data-mo-focus="' + ui_focus + '"]');
        if (found.length) element = found[0];
      }
      ui_focus = '';
      if (!element && fallback) element = fallback;
      if (element) last = element;
    };

    /**
     * С какой серии продолжать. Сначала смотрим на подтверждённое место
     * (его двигает просмотр подряд), потом на отметки источника, общую
     * историю и тайм-коды.
     */
    this.uiPickResume = function(items) {
      if (!items || !items.length) return null;
      var serial = object.movie.name ? true : false;
      var viewed = Lampa.Storage.cache('online_view', 5000, []);
      var i;
      if (!serial) {
        var movie_choice = this.getChoice();
        if (movie_choice.movie_view) {
          for (i = 0; i < items.length; i++) {
            if (items[i].hash_behold == movie_choice.movie_view) return items[i];
          }
        }
        var pref = Lampa.Storage.get('z01_voice_pref', '');
        if (pref) {
          for (i = 0; i < items.length; i++) {
            if (YarrossUI.voiceKind(items[i].title || items[i].text) == pref) return items[i];
          }
        }
        return items[0];
      }
      var choice = this.getChoice();
      var season = items[0].season;
      var reached = YarrossUI.reached(object.movie, season);
      if (!reached) {
        var mark = choice.episodes_view ? parseInt(choice.episodes_view[season], 10) : 0;
        if (mark > reached) reached = mark;
        var history = this.watched();
        if (history && history.episode && (!history.season || history.season == season)) {
          var last_seen = parseInt(history.episode, 10) || 0;
          if (last_seen > reached) reached = last_seen;
        }
        for (i = 0; i < items.length; i++) {
          if (YarrossUI.isSeen(items[i], viewed)) {
            var num = parseInt(items[i].episode, 10) || 0;
            if (num > reached) reached = num;
          }
        }
      }
      if (reached) {
        for (i = 0; i < items.length; i++) {
          if (items[i].episode == reached) {
            var line = items[i].timeline;
            if (line && line.percent > 0 && line.percent < 90) return items[i];
            for (var j = i + 1; j < items.length; j++) {
              if (!YarrossUI.isSeen(items[j], viewed)) return items[j];
            }
            return items[i + 1] || items[i];
          }
        }
        var best = null;
        for (i = 0; i < items.length; i++) {
          var value = parseInt(items[i].episode, 10) || 0;
          if (value > reached && (!best || value < (parseInt(best.episode, 10) || 0))) best = items[i];
        }
        if (best) return best;
        return items[items.length - 1];
      }
      for (i = 0; i < items.length; i++) {
        if (!YarrossUI.isSeen(items[i], viewed)) return items[i];
      }
      return items[0];
    };

    /**
     * Строка состояния вместо шапки с кнопкой: кнопка продолжения есть
     * на карточке фильма, дублировать её тут незачем. Показываем сезон,
     * счёт просмотренного и общий прогресс по сезону.
     */
    this.uiStatus = function(items) {
      if (!ui.status) return;
      var box = ui.status.empty().removeClass('mo-head--hidden');
      var serial = object.movie.name ? true : false;
      // У фильма название уже стоит над списком, а «осталось» видно прямо в
      // строке — шапка только повторяла бы то же самое. Оставляем её сериалам,
      // где она несёт номер сезона и счётчик просмотренного.
      if (ui_nav || !items.length || !serial) return box.addClass('mo-head--hidden');
      var viewed = Lampa.Storage.cache('online_view', 5000, []);
      var seen = 0;
      var i;
      for (i = 0; i < items.length; i++) {
        if (YarrossUI.isSeen(items[i], viewed)) seen++;
      }
      var title = '';
      if (serial) {
        var seasons = filter_find.season || [];
        var picked = seasons.length ? seasons[this.getChoice().season] || seasons[0] : null;
        if (picked && picked.title) title = picked.title;
        else {
          var season = items[0].season || this.seasonMemory() || 1;
          title = Lampa.Lang.translate('torrent_serial_season') + ' ' + season;
        }
      } else title = object.movie.title || object.movie.name || '';
      var note = '';
      if (serial && items.length > 1) {
        note = Lampa.Lang.translate('z01_season_progress').replace('{seen}', seen).replace('{total}', items.length);
        if (seen < items.length) note += ' · ' + Lampa.Lang.translate('z01_season_left').replace('{left}', items.length - seen);
      } else {
        var target = this.uiPickResume(items);
        var line = target && target.timeline;
        if (line && line.percent > 0 && line.duration > line.time) {
          note = Lampa.Lang.translate('z01_left') + ' ' + Lampa.Utils.secondsToTime(line.duration - line.time, true);
        }
      }
      var head = $('<div class="mo-head"><div class="mo-head__art"><img alt=""></div>' +
        '<div class="mo-head__text"><div class="mo-head__title"></div><div class="mo-head__sub"></div></div>' +
        '<div class="mo-head__note"></div></div>');
      head.find('.mo-head__title').text(title);
      head.find('.mo-head__note').text(note);
      head.find('.mo-head__art').remove();
      if (!serial && object.movie.original_title && object.movie.original_title !== title) {
        head.find('.mo-head__sub').text(object.movie.original_title);
      }
      box.append(head);
      // Пустую полосу не рисуем: пока ничего не просмотрено, она
      // выглядит как затемнение поперёк экрана.
      if (serial && items.length > 1 && seen) {
        var bar = $('<div class="mo-head__bar"><div class="mo-head__fill"></div></div>');
        bar.find('.mo-head__fill').css('width', Math.round(seen / items.length * 100) + '%');
        box.append(bar);
      }
      return box;
    };

    /**
     * Запасной кадр для серий, у которых TMDB не отдал still_path.
     */
    this.uiFallbackArt = function() {
      var movie = object.movie;
      var path = function(value) {
        if (!value || value === 'undefined') return '';
        return Lampa.TMDB.image('t/p/w300' + value);
      };
      var art = path(movie.backdrop_path);
      if (!art) art = path(movie.poster_path);
      if (!art && movie.img) {
        art = movie.img;
        if (art.indexOf('http') !== 0) art = '';
      }
      if (!art) art = path(movie.img);
      return art;
    };

    /**
     * Уточнение названия. Родная строка поиска живёт в скрытой панели
     * фильтров — дёргаем её напрямую, иначе поднимаем ввод сами.
     */
    this.uiSearch = function() {
      var native_search = filter.render().find('.filter--search');
      if (native_search.length) return native_search.trigger('hover:enter');
      if (Lampa.Input && Lampa.Input.edit) {
        var enabled = Lampa.Controller.enabled().name;
        Lampa.Input.edit({
          value: object.search || '',
          free: true,
          nosave: true,
          title: Lampa.Lang.translate('search')
        }, function(value) {
          Lampa.Controller.toggle(enabled);
          if (value && filter.onSearch) filter.onSearch(value);
        });
      }
    };

    /**
     * Панель выбора: источник, сезон, перевод — плоскими сегментами.
     * Раскрытый список идёт сеткой под панелью.
     */
    this.uiRows = function() {
      var _this = this;
      var panel = ui.panel.empty();
      var bar = $('<div class="mo-panel"></div>');

      var addSeg = function(key, name, value, mark) {
        var seg = $('<div class="mo-seg selector"><div class="mo-seg__name"></div><div class="mo-seg__value"></div><div class="mo-seg__arrow"></div></div>');
        seg.attr('data-mo-focus', key);
        seg.find('.mo-seg__name').text(name);
        var box = seg.find('.mo-seg__value');
        if (mark) box.append($('<span class="mo-seg__mark"></span>').text(mark));
        box.append(document.createTextNode(value));
        if (ui_open == key) seg.addClass('mo-seg--open');
        seg.on('hover:enter', function() {
          _this.uiToggle(key);
        }).on('hover:focus', function(e) {
          last = e.target;
          scroll.update($(e.target), true);
        });
        bar.append(seg);
      };

      if (!object.balanser && sourceKeys().length && balanser) {
        var info = sources[balanser] || {};
        var parts = YarrossUI.splitSourceName(info.name || balanser);
        addSeg('source', Lampa.Lang.translate('lampac_balanser'), parts.name, YarrossUI.sourceBadge(balanser, parts));
      }

      var choice = this.getChoice();
      var seasons = filter_find.season || [];
      if (seasons.length > 1) {
        addSeg('season', Lampa.Lang.translate('torrent_serial_season'), (seasons[choice.season] || seasons[0]).title, '');
      }

      var voices = filter_find.voice || [];
      if (voices.length > 1) {
        addSeg('voice', Lampa.Lang.translate('torrent_parser_voice'), (voices[choice.voice] || voices[0]).title, '');
      }

      if (similar_list && similar_list.length > 1 && !similar_shown) {
        var back = $('<div class="mo-seg selector"><div class="mo-seg__name"></div><div class="mo-seg__value"></div></div>');
        back.attr('data-mo-focus', 'variants');
        back.find('.mo-seg__name').text(Lampa.Lang.translate('z01_similar_all'));
        back.find('.mo-seg__value').text(similar_list.length);
        back.on('hover:enter', function() {
          var saved = similar_list;
          similar_auto = true;
          _this.uiSimilars(saved, true);
        }).on('hover:focus', function(e) {
          last = e.target;
          scroll.update($(e.target), true);
        });
        bar.append(back);
      }

      if (bar.children().length) panel.append(bar);

      if (ui_open == 'source' && !object.balanser) this.uiSourceRow();
      else if (ui_open == 'season') this.uiOptionRow('season');
      else if (ui_open == 'voice') this.uiOptionRow('voice');
    };

    /**
     * Порядок источников: сперва те, что сервер считает рабочими, потом
     * остальные; внутри — по качеству из названия и исходному порядку.
     */
    this.sourceOrder = function(names) {
      var rank = function(name) {
        if (name == balanser) return -1;
        return (sources[name] && sources[name].show) ? 0 : 1;
      };
      var quality = function(name) {
        var info = sources[name] || {};
        return YarrossUI.qualityRank(YarrossUI.sourceBadge(name, YarrossUI.splitSourceName(info.name || name)));
      };
      return names.map(function(name, index) {
        return {
          name: name,
          index: index
        };
      }).sort(function(a, b) {
        return (rank(a.name) - rank(b.name)) ||
          (quality(b.name) - quality(a.name)) ||
          (a.index - b.index);
      }).map(function(entry) {
        return entry.name;
      });
    };

    this.uiToggle = function(key) {
      var opening = ui_open != key;
      ui_open = opening ? key : '';
      ui_focus = key;
      if (opening) {
        var choice = this.getChoice();
        if (key == 'source' && balanser) ui_focus = 'src:' + balanser;
        else if (key == 'season') ui_focus = 'season:' + (choice.season || 0);
        else if (key == 'voice') ui_focus = 'voice:' + (choice.voice || 0);
      }
      this.uiRows();
      this.uiFocusRestore(false);
      Lampa.Controller.enable('content');
    };

    /**
     * Вправо из списка серий уводим на панель, а не открываем список
     * источников: так понятнее, куда ушёл фокус.
     */
    this.uiPanelFocus = function() {
      if (!modern || !ui.panel) return false;
      var seg = ui.panel.find('[data-mo-focus="source"]')[0] || ui.panel.find('.mo-seg')[0];
      if (!seg) return false;
      last = seg;
      scroll.update($(seg), true);
      Lampa.Controller.collectionFocus(seg, scroll.render());
      return true;
    };

    this.uiPanelFocused = function() {
      if (!modern || !ui.panel || !last) return false;
      return ui.panel.find(last).length > 0;
    };

    /**
     * Куда ведёт «вверх», когда прямо над фокусом пусто: из списка серий
     * на панель, а с панели — в меню лампы.
     */
    this.uiUpFallback = function() {
      if (!ui.root || !last) return false;
      if (ui.list && ui.list.find(last).length) return this.uiPanelFocus();
      return false;
    };

    /**
     * Список вариантов сеткой. Переводы показываем все — люди смотрят
     * в разных озвучках, прятать их не за чем.
     */
    this.uiOptionRow = function(type) {
      var _this = this;
      var list = filter_find[type] || [];
      var selected = this.getChoice()[type];
      var grid = $('<div class="mo-grid"></div>');
      // Переводы раскладываем по типу озвучки, сезоны идут как есть.
      var rows = [];
      if (type == 'voice') {
        YarrossUI.voiceGroups(list).forEach(function(group) {
          group.items.forEach(function(entry) {
            rows.push({
              index: entry.index,
              title: entry.title,
              note: group.title || ''
            });
          });
        });
      } else {
        list.forEach(function(item, index) {
          rows.push({
            index: index,
            title: item.title,
            note: ''
          });
        });
      }
      rows.forEach(function(entry) {
        var opt = $('<div class="mo-opt selector"><div class="mo-opt__in"><span class="mo-opt__label"></span><span class="mo-opt__note"></span></div></div>');
        opt.attr('data-mo-focus', type + ':' + entry.index);
        opt.find('.mo-opt__label').text(entry.title || '');
        opt.find('.mo-opt__note').text(entry.note);
        if (entry.index == selected) opt.addClass('mo-opt--active');
        opt.on('hover:enter', function() {
          _this.uiSwitch(type, entry.index);
        }).on('hover:focus', function(e) {
          last = e.target;
          scroll.update($(e.target), true);
        });
        grid.append(opt);
      });
      ui.panel.append(grid);
    };

    this.uiSwitch = function(type, index) {
      var choice = this.getChoice();
      if (choice[type] == index && ui_open) {
        ui_open = '';
        ui_focus = type;
        this.uiRows();
        this.uiFocusRestore(false);
        Lampa.Controller.enable('content');
        return;
      }
      choice[type] = index;
      if (type == 'voice') {
        var voice = filter_find.voice[index];
        if (voice) {
          choice.voice_name = voice.title;
          Lampa.Storage.set('z01_voice_pref', YarrossUI.voiceKind(voice.title));
        }
      }
      if (type == 'season') {
        var season = filter_find.season[index];
        if (season) {
          var number = YarrossUI.seasonNumber(season.title);
          if (number) this.seasonMemory(number);
        }
        season_pinned = true;
      }
      this.saveChoice(choice);
      ui_open = '';
      ui_focus = type;
      this.uiLoading();
      this.uiRows();
      this.find();
    };

    this.uiSourceMenu = function() {
      this.uiToggle('source');
    };

    /**
     * Список источников. Скрытые сервером не показываем — в бесплатной
     * версии список и так длинный, а разбираться, где что есть, помогает
     * автопереключение при пустом ответе.
     */
    this.uiSourceRow = function() {
      var _this = this;
      var all = sourceKeys();
      var visible = all.filter(function(name) {
        var info = sources[name] || {};
        return name == balanser || info.show || info.vip;
      });
      var grid = $('<div class="mo-grid"></div>');
      this.sourceOrder(visible).forEach(function(name) {
        var info = sources[name] || {};
        var parts = YarrossUI.splitSourceName(info.name || name);
        var opt = $('<div class="mo-opt selector"><div class="mo-opt__in"><span class="mo-opt__label"></span><span class="mo-opt__note"></span></div></div>');
        opt.attr('data-mo-focus', 'src:' + name);
        var label = opt.find('.mo-opt__label');
        var tag = YarrossUI.sourceBadge(name, parts);
        if (info.vip) label.append('<span class="mo-opt__tag">VIP</span>');
        else if (tag) label.append($('<span class="mo-opt__tag"></span>').text(tag));
        label.append(document.createTextNode(parts.name));
        if (name == balanser) opt.addClass('mo-opt--active');
        opt.on('hover:enter', function() {
          if (info.vip && !Lampa.Storage.get('zpremkey', '')) {
            return _this.vipOffer({
              title: info.name || name,
              source: name
            });
          }
          ui_open = '';
          if (name == balanser) {
            ui_focus = 'source';
            _this.uiRows();
            _this.uiFocusRestore(false);
            Lampa.Controller.enable('content');
            return;
          }
          _this.switchSource(name);
        }).on('hover:focus', function(e) {
          last = e.target;
          scroll.update($(e.target), true);
        });
        grid.append(opt);
      });
      ui.panel.append(grid);
    };

    /**
     * Смена источника без перезагрузки активности.
     */
    this.switchSource = function(name) {
      if (!sources[name]) return;
      // Yarross: auto-activate trial for VIP sources
      if (sources[name].vip && !Lampa.Storage.get('zpremkey', '')) {
        var _this = this;
        Lampa.Noty.show('Активируем Yarross Premium...');
        zpremTrial(function(ok, reason){
          if (ok) {
            zpremActivate();
            Lampa.Noty.show('Yarross Premium активирован! Перезагрузка...');
            setTimeout(function(){ location.reload(); }, 2000);
          } else {
            Lampa.Noty.show('Ошибка активации: ' + (reason || 'unknown'));
            Lampa.Controller.toggle('content');
          }
        });
        return;
      }
      if (!modern) {
        object.lampac_custom_select = name;
        return this.changeBalanser(name);
      }
      object.lampac_custom_select = name;
      balanser = name;
      source = sources[name].url;
      Lampa.Storage.set('online_balanser', name);
      Lampa.Storage.set('active_balanser', name);
      this.updateBalanser(name);
      filter_find = {
        season: [],
        voice: []
      };
      ui_tried[name] = true;
      ui_open = '';
      season_pinned = false;
      similar_list = null;
      similar_auto = false;
      ui_focus = 'source';
      this.uiLoading();
      this.uiRows();
      var seg = ui.panel.find('[data-mo-focus="source"]')[0];
      if (seg) last = seg;
      this.find();
      Lampa.Controller.toggle('content');
    };

    var sourceKeys = function() {
      return Object.prototype.toString.call(filter_sources) === '[object Array]' ? filter_sources : [];
    };

    /**
     * Куда уйти, когда у текущего источника пусто.
     */
    this.nextSource = function() {
      var _this = this;
      var keys = sourceKeys().filter(function(name) {
        if (!sources[name] || name === balanser || ui_tried[name]) return false;
        return sources[name].show;
      });
      if (!keys.length) return '';
      return this.sourceOrder(keys)[0];
    };

    /**
     * Служебный экран: всегда с выходом — другой источник, повтор,
     * уточнение названия.
     */
    this.uiNote = function(params) {
      var _this = this;
      this.uiFrame();
      this.uiLoadingStop();
      this.uiWatchStop();
      var note = $('<div class="mo-info"><div class="mo-info__title"></div><div class="mo-info__text"></div><div class="mo-info__acts"></div></div>');
      note.find('.mo-info__title').text(params.title || '');
      note.find('.mo-info__text').html(params.text || '');
      var acts = note.find('.mo-info__acts');
      (params.actions || []).forEach(function(action) {
        var button = $('<div class="mo-act selector"></div>');
        if (action.icon) button.append(action.icon);
        button.append($('<span></span>').text(action.title));
        button.on('hover:enter', function() {
          action.handler();
        }).on('hover:focus', function(e) {
          last = e.target;
          scroll.update($(e.target), true);
        });
        acts.append(button);
      });
      var link = params.qr || params.link || '';
      if (link) {
        var qr = $('<div class="mo-info__qr"><img alt=""></div>');
        qr.find('img').attr('src', YarrossUI.qrImage(link));
        note.find('.mo-info__text').after($('<div class="mo-info__link"></div>').text(link)).after(qr);
      }
      ui.list.empty().append(note);
      this.uiStatus([]);
      this.uiRows();
      this.loading(false);
      last = acts.find('.mo-act')[0] || false;
      Lampa.Controller.enable('content');
      return note;
    };

    /**
     * Отметить просмотренным всё до этой серии и снять отметки с тех,
     * что после: состояние становится ровно таким, как сказано.
     */
    this.markUpTo = function(element) {
      if (!element) return;
      var upto = parseInt(element.episode, 10) || 0;
      if (!upto) return;
      var viewed = Lampa.Storage.cache('online_view', 5000, []);
      var changed = false;
      for (var i = 0; i < ui_items.length; i++) {
        var item = ui_items[i];
        var num = parseInt(item.episode, 10) || 0;
        if (!num || !item.hash_behold) continue;
        if (num <= upto) {
          if (viewed.indexOf(item.hash_behold) === -1) {
            viewed.push(item.hash_behold);
            changed = true;
          }
        } else {
          if (viewed.indexOf(item.hash_behold) !== -1) {
            Lampa.Arrays.remove(viewed, item.hash_behold);
            Lampa.Storage.remove('online_view', item.hash_behold);
            changed = true;
          }
          var line = item.timeline;
          if (line && (line.percent || line.time)) {
            line.percent = 0;
            line.time = 0;
            line.duration = 0;
            Lampa.Timeline.update(line);
          }
        }
      }
      if (changed) Lampa.Storage.set('online_view', viewed);
      YarrossUI.setReach(object.movie, element.season, upto);
      var choice = this.getChoice();
      if (element.season) choice.episodes_view[element.season] = upto;
      this.saveChoice(choice);
      this.uiRefreshMarks();
    };

    this.uiDraw = function(items, params) {
      var _this = this;
      params = params || {};
      if (!items.length) return this.empty();
      this.uiFrame();
      this.uiLoadingStop();
      this.uiWatchStop();
      ui_items = items;
      ui_enter = params.onEnter;
      similar_shown = false;
      if (!params.similars) YarrossUI.rememberQuality(balanser, YarrossUI.bestQuality(items));
      var serial = object.movie.name ? true : false;

      var title_count = {};
      items.forEach(function(item) {
        var text = item.text || item.title || '';
        title_count[text] = (title_count[text] || 0) + 1;
      });

      var looksEpisode = function(text) {
        return /сери|episode|эпізод|эпизод/i.test(String(text || '')) || /^\s*\d+\s*$/.test(String(text || ''));
      };
      // Часть источников отдаёт сезоны и папки обычными строками списка:
      // тогда это переходы, а не серии — ни номеров, ни отметок.
      ui_nav = items.length > 1 && items.every(function(item) {
        var text = item.text || item.title || '';
        if (YarrossUI.isSeasonLabel(text)) return true;
        return serial && typeof item.episode === 'undefined' && !looksEpisode(text);
      });

      var draw_gen = request_gen;
      this.getEpisodes(items[0].season, function(episodes) {
        if (draw_gen !== request_gen) return;
        var viewed = Lampa.Storage.cache('online_view', 5000, []);
        var choice = _this.getChoice();
        var fully = window.innerWidth > 580;
        var list = ui.list.empty();
        if (serial && !ui_nav) list.addClass('mo-tiles');
        else list.removeClass('mo-tiles');
        var focus_element = false;
        var focus_mark = false;
        var resume = _this.uiPickResume(items);

        if (serial && items[0] && items[0].season) {
          var shown_season = parseInt(items[0].season);
          var wanted_season = _this.seasonMemory();
          if (shown_season && (!wanted_season || shown_season == wanted_season || _this.seasonIndexByMemory() >= 0)) {
            _this.seasonMemory(shown_season);
          }
        }

        items.forEach(function(element, index) {
          var episode = serial && episodes.length && !params.similars ? arrFind(episodes, function(e) {
            return e.episode_number == element.episode;
          }) : false;
          var episode_num = element.episode || index + 1;
          // У фильма строки — это разные озвучки, и у каждой должно быть
          // своё имя: иначе хеш у всех один, и отметка о просмотре
          // прилипает сразу ко всему списку.
          var voice_name = (!serial && (element.voice_name || element.text)) ||
            choice.voice_name || (filter_find.voice[0] ? filter_find.voice[0].title : false) ||
            element.voice_name || (serial ? Lampa.Lang.translate('z01_unknown') : element.text) ||
            Lampa.Lang.translate('z01_unknown');

          if (element.quality) {
            element.qualitys = element.quality;
            element.quality = Lampa.Arrays.getKeys(element.quality)[0];
          }
          element.voice_name = voice_name;
          var runtime = episode ? episode.runtime : object.movie.runtime;
          element.time = runtime ? Lampa.Utils.secondsToTime(runtime * 60, true) : '';

          var hash_timeline = Lampa.Utils.hash(element.season ? [element.season, element.season > 10 ? ':' : '', element.episode, object.movie.original_title].join('') : object.movie.original_title);
          var hash_behold = Lampa.Utils.hash(element.season ? [element.season, element.season > 10 ? ':' : '', element.episode, object.movie.original_title, element.voice_name].join('') : object.movie.original_title + element.voice_name);
          element.hash_behold = hash_behold;
          element.hash_timeline = hash_timeline;
          element.timeline = Lampa.Timeline.view(hash_timeline);
          if (element.season) {
            element.translate_episode_end = _this.getLastEpisode(items);
            element.translate_voice = element.voice_name;
          }
          var data = {
            hash_timeline: hash_timeline,
            hash_behold: hash_behold
          };

          var title = (episode ? episode.name : (element.text || element.title)) || object.movie.title || object.movie.name || '';
          element.title = title;

          var meta = [];
          if (episode && episode.vote_average) meta.push('★ ' + parseFloat(episode.vote_average + '').toFixed(1));
          if (episode && episode.air_date && fully) meta.push(Lampa.Utils.parseTime(episode.air_date).full);
          else if (!episode && object.movie.release_date && fully && serial) meta.push(Lampa.Utils.parseTime(object.movie.release_date).full);
          if (!serial && !ui_nav && voice_name && voice_name !== title && voice_name !== Lampa.Lang.translate('z01_unknown')) meta.push(voice_name);
          element.__meta_base = meta.slice();
          // Тайм-код у фильма один на все переводы, поэтому «осталось» и
          // полоса показываются только у того варианта, который смотрели.
          element.__own_line = !ui_nav && (serial || choice.movie_view === hash_behold);
          var seen_line = element.timeline;
          if (element.__own_line && seen_line && seen_line.percent > 0 && seen_line.duration > seen_line.time) {
            meta.push(Lampa.Lang.translate('z01_left') + ' ' + Lampa.Utils.secondsToTime(seen_line.duration - seen_line.time, true));
          }

          // Серии — плитками с кадром, переводы фильма и переходы —
          // строками: у них кадр один на всех и различает их только текст.
          var tile = serial && !ui_nav;
          var html;
          if (tile) {
            html = $('<div class="mo-tile selector">' +
              '<div class="mo-tile__art"><img alt=""><div class="mo-tile__num"></div><div class="mo-tile__line"></div></div>' +
              '<div class="mo-tile__body"><div class="mo-tile__title"></div><div class="mo-tile__meta"></div></div>' +
              '</div>');
            html.find('.mo-tile__title').text(title);
            html.find('.mo-tile__meta').html(meta.map(function(part) {
              return '<span>' + YarrossUI.esc(part) + '</span>';
            }).join(''));
            html.find('.mo-tile__num').text(YarrossUI.episodeNumber(episode_num));
            var art_box = html.find('.mo-tile__art');
            var badge = YarrossUI.shortQuality(element.quality);
            if (badge) art_box.append($('<div class="mo-tile__tag"></div>').text(badge));
            if (element.time) art_box.append($('<div class="mo-tile__time"></div>').text(element.time));
            if (element.timeline && element.__own_line) html.find('.mo-tile__line').append(Lampa.Timeline.render(element.timeline));
            var art = episode && episode.still_path ? Lampa.TMDB.image('t/p/w300' + episode.still_path) : _this.uiFallbackArt();
            if (art) {
              var img = html.find('img')[0];
              img.onload = function() {
                art_box.addClass('mo-tile__art--loaded');
              };
              img.onerror = function() {};
              img.src = art;
              images.push(img);
              element.thumbnail = art;
            }
          } else {
            html = $('<div class="mo-line selector">' +
              '<div class="mo-line__art"><img alt=""></div>' +
              '<div class="mo-line__body"><div class="mo-line__title"></div><div class="mo-line__note"></div></div>' +
              '<div class="mo-line__side"></div>' +
              '<div class="mo-line__line"></div>' +
              '</div>');
            html.find('.mo-line__title').text(title);
            html.find('.mo-line__note').text(meta.join(' · '));
            var side_box = html.find('.mo-line__side');
            var line_badge = YarrossUI.shortQuality(element.quality);
            if (line_badge) side_box.append($('<div class="mo-line__tag"></div>').text(line_badge));
            if (element.time) side_box.append($('<div class="mo-line__time"></div>').text(element.time));
            if (element.timeline && element.__own_line && element.timeline.percent > 0) {
              html.find('.mo-line__line').append(Lampa.Timeline.render(element.timeline));
            }
            if (ui_nav) {
              html.addClass('mo-line--nav');
              html.find('.mo-line__art').remove();
              html.find('.mo-line__line').remove();
              side_box.empty();
              if (title_count[title] > 1) {
                var provider = YarrossUI.providerName(element.url);
                if (provider) html.find('.mo-line__note').text(provider);
              }
            } else {
              var line_box = html.find('.mo-line__art');
              var line_art = _this.uiFallbackArt();
              if (line_art) {
                var line_img = html.find('img')[0];
                line_img.onload = function() {
                  line_box.addClass('mo-line__art--loaded');
                };
                line_img.onerror = function() {};
                line_img.src = line_art;
                images.push(line_img);
                element.thumbnail = line_art;
              } else line_box.remove();
            }
          }
          element.__html = html;

          var addViewed = function() {
            if (!element.__html) return;
            var row = element.__html;
            // Отметка — про серии. У фильма строки это переводы, и
            // «просмотрено» там означало бы «открывали»: половина списка
            // выглядела бы вычеркнутой ни за что.
            if (!tile) return;
            row.addClass('mo-tile--seen');
            if (!row.find('.mo-tile__check').length) {
              row.find('.mo-tile__art').append('<div class="mo-tile__check">' + YarrossUI.icon.check + '</div>');
            }
          };
          if (!ui_nav && YarrossUI.isSeen(element, viewed)) {
            focus_mark = html;
            addViewed();
          }
          if (resume === element) {
            html.addClass(tile ? 'mo-tile--current' : 'mo-line--current');
            focus_element = html;
          }

          element.mark = function() {
            viewed = Lampa.Storage.cache('online_view', 5000, []);
            if (viewed.indexOf(hash_behold) == -1) {
              viewed.push(hash_behold);
              Lampa.Storage.set('online_view', viewed);
              addViewed();
            }
            choice = _this.getChoice();
            if (!serial) choice.movie_view = hash_behold;
            else {
              choice.episodes_view[element.season] = episode_num;
              YarrossUI.rememberReach(object.movie, element.season, episode_num);
            }
            _this.saveChoice(choice);
            var voice_text = choice.voice_name || element.voice_name || element.title;
            if (voice_text.length > 30) voice_text = voice_text.slice(0, 30) + '...';
            _this.watched({
              balanser: balanser,
              balanser_name: Lampa.Utils.capitalizeFirstLetter(sources[balanser] ? sources[balanser].name.split(' ')[0] : balanser),
              voice_id: choice.voice_id,
              voice_name: voice_text,
              episode: element.episode,
              season: element.season
            });
            _this.uiRefreshMarks();
          };
          element.unmark = function() {
            viewed = Lampa.Storage.cache('online_view', 5000, []);
            if (viewed.indexOf(hash_behold) !== -1) {
              Lampa.Arrays.remove(viewed, hash_behold);
              Lampa.Storage.set('online_view', viewed);
              Lampa.Storage.remove('online_view', hash_behold);
            }
            if (element.__html) {
              element.__html.removeClass('mo-tile--seen');
              element.__html.find('.mo-tile__check').remove();
            }
            _this.uiRefreshMarks();
          };
          element.timeclear = function() {
            element.timeline.percent = 0;
            element.timeline.time = 0;
            element.timeline.duration = 0;
            Lampa.Timeline.update(element.timeline);
            _this.uiRefreshMarks();
          };

          html.on('hover:enter', function() {
            if (ui_nav) {
              if (!element.url) return;
              ui_focus = '';
              _this.uiLoading();
              _this.request(element.url);
              return;
            }
            if (object.movie.id) Lampa.Favorite.add('history', object.movie, 100);
            if (params.onEnter) params.onEnter(element, html, data);
          }).on('hover:focus', function(e) {
            last = e.target;
            if (params.onFocus) params.onFocus(element, html, data);
            scroll.update($(e.target), true);
          });

          if (!ui_nav) _this.contextMenu({
            html: html,
            element: element,
            onFile: function onFile(call) {
              if (params.onContextMenu) params.onContextMenu(element, html, data, call);
            },
            onClearAllMark: function onClearAllMark() {
              items.forEach(function(elem) {
                elem.unmark();
              });
            },
            onClearAllTime: function onClearAllTime() {
              items.forEach(function(elem) {
                elem.timeclear();
              });
            }
          });

          list.append(html);
        });

        // ещё не вышедшие серии — приглушённым хвостом списка
        if (serial && episodes.length > items.length && !params.similars) {
          episodes.slice(items.length).forEach(function(episode) {
            var meta = [];
            if (episode.vote_average) meta.push('★ ' + parseFloat(episode.vote_average + '').toFixed(1));
            if (episode.air_date) meta.push(Lampa.Utils.parseTime(episode.air_date).full);
            var air = new Date((episode.air_date + '').replace(/-/g, '/'));
            var days = Math.round((air.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
            var row = $('<div class="mo-tile mo-tile--soon">' +
              '<div class="mo-tile__art"><img alt=""><div class="mo-tile__num"></div></div>' +
              '<div class="mo-tile__body"><div class="mo-tile__title"></div><div class="mo-tile__meta"></div></div>' +
              '</div>');
            row.find('.mo-tile__num').text(YarrossUI.episodeNumber(episode.episode_number));
            row.find('.mo-tile__title').text(episode.name || '');
            row.find('.mo-tile__meta').html(meta.map(function(part) {
              return '<span>' + YarrossUI.esc(part) + '</span>';
            }).join(''));
            if (days > 0) row.find('.mo-tile__art').append($('<div class="mo-tile__time"></div>').text(Lampa.Lang.translate('full_episode_days_left') + ': ' + days));
            var soon_box = row.find('.mo-tile__art');
            var soon_art = episode.still_path ? Lampa.TMDB.image('t/p/w300' + episode.still_path) : _this.uiFallbackArt();
            if (soon_art) {
              var soon_img = row.find('img')[0];
              soon_img.onload = function() {
                soon_box.addClass('mo-tile__art--loaded');
              };
              soon_img.onerror = function() {};
              soon_img.src = soon_art;
              images.push(soon_img);
            }
            list.append(row);
          });
        }

        _this.uiStatus(items);
        _this.uiRows();

        // Кнопки продолжения тут нет — фокус сразу на серии, с которой
        // продолжаем, иначе список каждый раз открывался бы с начала.
        var fallback = focus_element || focus_mark || false;
        if (fallback && fallback.jquery) fallback = fallback[0];
        if (!fallback) fallback = list.find('.mo-tile, .mo-line')[0];
        _this.uiFocusRestore(fallback);

        _this.loading(false);
        Lampa.Controller.enable('content');

        if (object.lampac_continue_episode) {
          var target_ep = object.lampac_continue_episode;
          delete object.lampac_continue_episode;
          var target_item = arrFind(items, function(el) {
            return el.episode == target_ep;
          });
          if (target_item && target_item.__html) {
            setTimeout(function() {
              last = target_item.__html[0];
              scroll.update(target_item.__html, true);
              target_item.__html.trigger('hover:enter');
            }, 300);
          }
        }
      });
    };

    /**
     * Пересчёт после плеера: полоса, остаток, отметка и счёт в строке
     * состояния — без перерисовки всего списка.
     */
    this.uiRefreshMarks = function() {
      if (!modern || !ui.list || !ui_items.length) return;
      var viewed = Lampa.Storage.cache('online_view', 5000, []);
      // У фильма прогресс принадлежит тому варианту, который запустили,
      // а выбор мог поменяться уже после отрисовки списка.
      var choice_now = this.getChoice();
      var serial_now = object.movie.name ? true : false;
      ui_items.forEach(function(element) {
        var html = element.__html;
        if (!html || !html.length) return;
        if (!ui_nav) element.__own_line = serial_now || choice_now.movie_view === element.hash_behold;
        if (element.hash_timeline) element.timeline = Lampa.Timeline.view(element.hash_timeline);
        var line = element.timeline;
        var tile = html.hasClass('mo-tile');
        var box = html.find(tile ? '.mo-tile__line' : '.mo-line__line');
        if (box.length && line && element.__own_line) {
          box.empty();
          if (line.percent > 0) box.append(Lampa.Timeline.render(line));
        }
        if (element.__meta_base) {
          var meta = element.__meta_base.slice();
          if (element.__own_line && line && line.percent > 0 && line.duration > line.time) {
            meta.push(Lampa.Lang.translate('z01_left') + ' ' + Lampa.Utils.secondsToTime(line.duration - line.time, true));
          }
          if (tile) {
            html.find('.mo-tile__meta').html(meta.map(function(part) {
              return '<span>' + YarrossUI.esc(part) + '</span>';
            }).join(''));
          } else html.find('.mo-line__note').text(meta.join(' · '));
        }
        if (tile && YarrossUI.isSeen(element, viewed)) {
          html.addClass('mo-tile--seen');
          if (!html.find('.mo-tile__check').length) {
            html.find('.mo-tile__art').append('<div class="mo-tile__check">' + YarrossUI.icon.check + '</div>');
          }
        }
      });
      var resume = this.uiPickResume(ui_items);
      ui.list.find('.mo-tile--current, .mo-line--current').removeClass('mo-tile--current mo-line--current');
      if (resume && resume.__html) resume.__html.addClass(resume.__html.hasClass('mo-tile') ? 'mo-tile--current' : 'mo-line--current');
      this.uiStatus(ui_items);
    };

    /**
     * Каталог похожих: источник не понял, какой именно фильм нужен.
     */
    this.uiSimilars = function(json, manual) {
      var _this = this;
      var rank = YarrossUI.rankSimilars(json, object.movie);
      if (!manual && !similar_auto && rank.sure) {
        similar_list = json;
        similar_auto = true;
        ui_focus = '';
        this.uiLoading();
        return this.request(rank.best.elem.url);
      }
      similar_list = json;
      similar_shown = true;
      this.uiFrame();
      this.uiLoadingStop();
      this.uiWatchStop();
      var list = ui.list.empty().addClass('mo-tiles');
      rank.list.forEach(function(row) {
        var elem = row.elem;
        var info = [];
        var year = ((elem.start_date || elem.year || '') + '').slice(0, 4);
        if (year) info.push(year);
        if (elem.details) info.push(elem.details);
        var html = $('<div class="mo-tile selector">' +
          '<div class="mo-tile__art"><img alt=""></div>' +
          '<div class="mo-tile__body"><div class="mo-tile__title"></div><div class="mo-tile__meta"></div></div>' +
          '</div>');
        html.find('.mo-tile__title').text(elem.title || elem.text || '');
        html.find('.mo-tile__meta').html(info.map(function(part) {
          return '<span>' + YarrossUI.esc(part) + '</span>';
        }).join(''));
        if (rank.likely && row === rank.best) {
          html.addClass('mo-tile--current');
          html.find('.mo-tile__art').append($('<div class="mo-tile__tag"></div>').text(Lampa.Lang.translate('z01_similar_best')));
        }
        if (elem.img) {
          var art = elem.img;
          if (art.charAt(0) === '/') art = (last_origin || Defined.localhost) + art.substring(1);
          if (art.indexOf('/proxyimg') !== -1) art = account(art);
          var num_box = html.find('.mo-tile__art');
          var img = html.find('img')[0];
          img.onload = function() {
            num_box.addClass('mo-tile__art--loaded');
          };
          img.onerror = function() {};
          img.src = art;
          images.push(img);
        }
        html.on('hover:enter', function() {
          ui_focus = '';
          _this.uiLoading();
          _this.request(elem.url);
        }).on('hover:focus', function(e) {
          last = e.target;
          scroll.update($(e.target), true);
        });
        list.append(html);
      });
      this.uiStatus([]);
      this.uiRows();
      this.filter({
        season: filter_find.season.map(function(s) {
          return s.title;
        }),
        voice: filter_find.voice.map(function(b) {
          return b.title;
        })
      }, this.getChoice());
      this.loading(false);
      last = list.find('.mo-tile')[0] || false;
      Lampa.Controller.enable('content');
    };

    /**
     * Предложение премиума при выборе VIP-источника.
     */
        this.vipOffer = function(a) {
      // Yarross: auto-activate trial instead of showing pay modal
      var _this = this;
      Lampa.Noty.show('Активируем Yarross Premium...');
      zpremTrial(function(ok, reason){
        if (ok) {
          zpremActivate();
          Lampa.Noty.show('Yarross Premium активирован! Перезагрузка...');
          setTimeout(function(){ location.reload(); }, 2000);
        } else {
          Lampa.Noty.show('Ошибка активации: ' + (reason || 'unknown'));
          Lampa.Controller.toggle('content');
        }
      });
    };

    this.initialize = function() {
      var _this = this;
      this.loading(true);
      filter.onSearch = function(value) {
		  
		clarificationSearchAdd(value);
		
        Lampa.Activity.replace({
          search: value,
          clarification: true,
          similar: true
        });
      };
      filter.onBack = function() {
        _this.start();
      };
      filter.render().find('.selector').on('hover:enter', function() {
        clearInterval(balanser_timer);
      });
      filter.render().find('.filter--search').appendTo(filter.render().find('.torrent-filter'));
      filter.onSelect = function(type, a, b) {
        if (type == 'sort' && sources[a.source] && sources[a.source].vip && !Lampa.Storage.get('zpremkey','')) {
          Lampa.Select.close();
          _this.vipOffer(a);
          return;
        }
        if (type == 'filter') {
          if (a.reset) {
			  clarificationSearchDelete();
			  
            _this.replaceChoice({
              season: 0,
              voice: 0,
              voice_url: '',
              voice_name: ''
            });
            setTimeout(function() {
              Lampa.Select.close();
              Lampa.Activity.replace({
				  clarification: 0,
				  similar: 0
			  });
            }, 10);
          } else {
            var url = filter_find[a.stype][b.index].url;
            var choice = _this.getChoice();
            if (a.stype == 'season') _this.seasonMemory(YarrossUI.seasonNumber(filter_find.season[b.index].title));
            if (a.stype == 'voice') {
              choice.voice_name = filter_find.voice[b.index].title;
              choice.voice_url = url;
            }
            choice[a.stype] = b.index;
            _this.saveChoice(choice);
            _this.reset();
            _this.request(url);
            setTimeout(Lampa.Select.close, 10);
          }
        } else if (type == 'sort') {
          Lampa.Select.close();
          _this.switchSource(a.source);
        }
      };
      if (filter.addButtonBack) filter.addButtonBack();
      filter.render().find('.filter--sort span').text(Lampa.Lang.translate('lampac_balanser'));
      scroll.body().addClass('torrent-list');
      files.appendFiles(scroll.render());
      files.appendHead(filter.render());
      scroll.minus(files.render().find('.explorer__files-head'));
      if (modern) {
        // управление переехало на экран — родная панель фильтров прячется,
        // но остаётся живой: через неё работает уточнение поиска
        files.render().find('.explorer__files-head').addClass('mo-hidden-head').css('display', 'none');
        scroll.minus(files.render().find('.explorer__files-head'));
        this.uiLoadingPanel();
      } else {
        scroll.body().append(Lampa.Template.get('lampac_content_loading'));
      }
      Lampa.Controller.enable('content');
      this.loading(false);
	  if(object.balanser){
		  files.render().find('.filter--search').remove();
		  sources = {};
		  sources[object.balanser] = {name: object.balanser};
		  balanser = object.balanser;
		  filter_sources = [];
		  
		  return network["native"](account(object.url.replace('rjson=','nojson=')), this.parse.bind(this), function(){
			  files.render().find('.torrent-filter').remove();
			  _this.empty();
		  }, false, {
            dataType: 'text',
			headers: {'X-Kit-AesGcm': Lampa.Storage.get('aesgcmkey', ''), 'X-Zprem-Key': Lampa.Storage.get('zpremkey', '')}
		  });
	  } 
      var askServer = function() {
        return _this.createSource().then(function(json) {
          if (!arrFind(balansers_with_search, function(b) {
              return balanser.slice(0, b.length) == b;
            })) {
            filter.render().find('.filter--search').addClass('hide');
          }
          _this.search();
        })["catch"](function(e) {
          if (zpremDrop(e)) {
            _this.memkey = '';
            return askServer();
          }
          _this.noConnectToServer(e);
        });
      };
      this.externalids().then(askServer);
    };
    this.rch = function(json, noreset) {
      var _this2 = this;
	  rchRun(json, function() {
        if (!noreset) _this2.find();
        else noreset();
	  });
    };
    this.externalids = function() {
      return new Promise(function(resolve, reject) {
        if (!object.movie.imdb_id || !object.movie.kinopoisk_id) {
          var query = [];
          query.push('id=' + encodeURIComponent(object.movie.id));
          query.push('serial=' + (object.movie.name ? 1 : 0));
          if (object.movie.imdb_id) query.push('imdb_id=' + (object.movie.imdb_id || ''));
          if (object.movie.kinopoisk_id) query.push('kinopoisk_id=' + (object.movie.kinopoisk_id || ''));
          var url = Defined.localhost + 'externalids?' + query.join('&');
          network.timeout(10000);
          network.silent(account(url), function(json) {
            for (var name in json) {
              object.movie[name] = json[name];
            }
            resolve();
          }, function() {
            resolve();
          }, false, {
			headers: {'X-Kit-AesGcm': Lampa.Storage.get('aesgcmkey', ''), 'X-Zprem-Key': Lampa.Storage.get('zpremkey', '')}
		  });
        } else resolve();
      });
    };
    this.updateBalanser = function(balanser_name) {
      var last_select_balanser = Lampa.Storage.cache('online_last_balanser', 3000, {});
      last_select_balanser[object.movie.id] = balanser_name;
      Lampa.Storage.set('online_last_balanser', last_select_balanser);
    };
    this.changeBalanser = function(balanser_name) {
      this.updateBalanser(balanser_name);
      Lampa.Storage.set('online_balanser', balanser_name);
      var to = this.getChoice(balanser_name);
      var from = this.getChoice();
      if (from.voice_name) to.voice_name = from.voice_name;
      this.saveChoice(to, balanser_name);
      Lampa.Activity.replace();
    };
    this.requestParams = function(url) {
      var query = [];
      var card_source = object.movie.source || 'tmdb'; //Lampa.Storage.field('source')
      query.push('id=' + encodeURIComponent(object.movie.id));
      if (object.movie.imdb_id) query.push('imdb_id=' + (object.movie.imdb_id || ''));
      if (object.movie.kinopoisk_id) query.push('kinopoisk_id=' + (object.movie.kinopoisk_id || ''));
	  if (object.movie.tmdb_id) query.push('tmdb_id=' + (object.movie.tmdb_id || ''));
      query.push('title=' + encodeURIComponent(object.clarification ? object.search : object.movie.title || object.movie.name));
      query.push('original_title=' + encodeURIComponent(object.movie.original_title || object.movie.original_name));
      query.push('serial=' + (object.movie.name ? 1 : 0));
      query.push('original_language=' + (object.movie.original_language || ''));
      query.push('year=' + ((object.movie.release_date || object.movie.first_air_date || '0000') + '').slice(0, 4));
      query.push('source=' + card_source);
      query.push('clarification=' + (object.clarification ? 1 : 0));
      query.push('similar=' + (object.similar ? true : false));
      query.push('rchtype=' + (((window.rch_nws && window.rch_nws[hostkey]) ? window.rch_nws[hostkey].type : (window.rch && window.rch[hostkey]) ? window.rch[hostkey].type : '') || ''));
      if (Lampa.Storage.get('account_email', '')) query.push('cub_id=' + Lampa.Utils.hash(Lampa.Storage.get('account_email', '')));
      return url + (url.indexOf('?') >= 0 ? '&' : '?') + query.join('&');
    };
    this.getLastChoiceBalanser = function() {
      var last_select_balanser = Lampa.Storage.cache('online_last_balanser', 3000, {});
      if (last_select_balanser[object.movie.id]) {
        return last_select_balanser[object.movie.id];
      } else {
        return Lampa.Storage.get('online_balanser', filter_sources.length ? filter_sources[0] : '');
      }
    };
    // на сериале «фильмовые» источники в список не попадают
    var acceptSource = function(key, title) {
      if (!object.movie.name) return true;
      return !YarrossUI.isMovieOnlySource(key, title);
    };

    this.startSource = function(json) {
      return new Promise(function(resolve, reject) {
        json.forEach(function(j) {
          var name = balanserName(j);
          if (!acceptSource(name, j.name)) return;
          sources[name] = {
            url: j.url,
            name: j.name,
            show: typeof j.show == 'undefined' ? true : j.show
          };
          syncBalanser(name);
        });
        filter_sources = Lampa.Arrays.getKeys(sources);
        if(isRuUser() && !Lampa.Storage.get('zpremkey','')){ var _trialTag = !Lampa.Storage.get('zprem_trial_used','') ? ' [demo]' : ''; ['Filmix 4K VIP','HDRezka 4K VIP','KinoPub 4K VIP','Alloha 4K VIP'].forEach(function(n){ var k='vip_'+n.toLowerCase().replace(/\s/g,'_'); if(!sources[k]){ sources[k]={name:n+_trialTag,url:'',show:false,vip:true}; filter_sources.push(k); } }); }
        if (filter_sources.length) {
          var last_select_balanser = Lampa.Storage.cache('online_last_balanser', 3000, {});
          if (last_select_balanser[object.movie.id]) {
            balanser = last_select_balanser[object.movie.id];
          } else {
            balanser = Lampa.Storage.get('online_balanser', filter_sources[0]);
          }
          if (!sources[balanser]) balanser = filter_sources[0];
          // Источник, с которого этот фильм уже смотрели, не сбрасываем:
          // сервер помечает show:false и там, где кино есть, а человек
          // возвращается именно туда, где остановился.
          var kept = last_select_balanser[object.movie.id] == balanser;
          if (!sources[balanser].show && !object.lampac_custom_select && !kept) balanser = filter_sources[0];
          source = sources[balanser].url;
          Lampa.Storage.set('active_balanser', balanser);
          resolve(json);
        } else {
          reject();
        }
      });
    };
    this.lifeSource = function() {
      var _this3 = this;
      return new Promise(function(resolve, reject) {
        var url = _this3.requestParams(Defined.localhost + 'lifeevents?memkey=' + (_this3.memkey || ''));
        var red = false;
        var gou = function gou(json, any) {
          if (json.accsdb || YarrossUI.serverDenial(json)) return reject(json);
          var last_balanser = _this3.getLastChoiceBalanser();
          if (!red) {
            var _filter = json.online.filter(function(c) {
              return any ? c.show : c.show && c.name.toLowerCase() == last_balanser;
            });
            if (_filter.length) {
              red = true;
              resolve(json.online.filter(function(c) {
                return c.show;
              }));
            } else if (any) {
              reject();
            }
          }
        };
        var fin = function fin(call) {
          network.timeout(3000);
          network.silent(account(url), function(json) {
            life_wait_times++;
            filter_sources = [];
            sources = {};
            json.online.forEach(function(j) {
              var name = balanserName(j);
              if (!acceptSource(name, j.name)) return;
              sources[name] = {
                url: j.url,
                name: j.name,
                show: typeof j.show == 'undefined' ? true : j.show
              };
              syncBalanser(name);
            });
            filter_sources = Lampa.Arrays.getKeys(sources);
            if(isRuUser() && !Lampa.Storage.get('zpremkey','')){ var _trialTag = !Lampa.Storage.get('zprem_trial_used','') ? ' [demo]' : ''; ['Filmix 4K VIP','HDRezka 4K VIP','KinoPub 4K VIP','Alloha 4K VIP'].forEach(function(n){ var k='vip_'+n.toLowerCase().replace(/\s/g,'_'); if(!sources[k]){ sources[k]={name:n+_trialTag,url:'',show:false,vip:true}; filter_sources.push(k); } }); }
            filter.set('sort', filter_sources.map(function(e) {
              return {
                title: sources[e].name,
                source: e,
                selected: e == balanser,
                ghost: !sources[e].show
              };
            }));
            filter.chosen('sort', [sources[balanser] ? sources[balanser].name : balanser]);
            _this3.uiLoadingProgress(json, life_wait_times);
            gou(json);
            var lastb = _this3.getLastChoiceBalanser();
            if (life_wait_times > 15 || json.ready) {
              filter.render().find('.lampac-balanser-loader').remove();
              gou(json, true);
            } else if (!red && sources[lastb] && sources[lastb].show) {
              gou(json, true);
              life_wait_timer = setTimeout(fin, 1000);
            } else {
              life_wait_timer = setTimeout(fin, 1000);
            }
          }, function() {
            life_wait_times++;
            if (life_wait_times > 15) {
              reject();
            } else {
              life_wait_timer = setTimeout(fin, 1000);
            }
          }, false, {
			headers: {'X-Kit-AesGcm': Lampa.Storage.get('aesgcmkey', ''), 'X-Zprem-Key': Lampa.Storage.get('zpremkey', '')}
		  });
        };
        fin();
      });
    };
    this.createSource = function() {
      var _this4 = this;
      return new Promise(function(resolve, reject) {
        var url = _this4.requestParams(Defined.localhost + 'lite/events?life=true');
        network.timeout(15000);
        network.silent(account(url), function(json) {
          if (json.accsdb || YarrossUI.serverDenial(json)) return reject(json);
          if (json.life) {
			_this4.memkey = json.memkey;
			if (json.title) {
              if (object.movie.name) object.movie.name = json.title;
              if (object.movie.title) object.movie.title = json.title;
			}
            filter.render().find('.filter--sort').append('<span class="lampac-balanser-loader" style="width: 1.2em; height: 1.2em; margin-top: 0; background: url(./img/loader.svg) no-repeat 50% 50%; background-size: contain; margin-left: 0.5em"></span>');
            _this4.lifeSource().then(_this4.startSource).then(resolve)["catch"](reject);
          } else {
            _this4.startSource(json).then(resolve)["catch"](reject);
          }
        }, reject, false, {
			headers: {'X-Kit-AesGcm': Lampa.Storage.get('aesgcmkey', ''), 'X-Zprem-Key': Lampa.Storage.get('zpremkey', '')}
		  });
      });
    };
    /**
     * Подготовка
     */
    this.create = function() {
      return this.render();
    };
    /**
     * Начать поиск
     */
    this.search = function() { //this.loading(true)
      this.filter({
        source: filter_sources
      }, this.getChoice());
      this.find();
    };
    this.find = function() {
      this.request(this.requestParams(source));
    };
    this.request = function(url) {
      var _this = this;
      // Адрес источника может указывать на другой сервер, чем выбранный
      // пингом. Относительные картинки надо тянуть оттуда же, откуда
      // пришли данные, иначе на другом сервере их просто нет.
      var origin = String(url).match(/^(https?:\/\/[^\/]+)\//);
      if (origin) last_origin = origin[1] + '/';
      number_of_requests++;
      if (number_of_requests < 10) {
        this.uiWatch();
        // Медленный ответ от прошлого запроса не должен дорисовываться
        // поверх нового списка — иначе сезоны задваиваются.
        var gen = ++request_gen;
        network.timeout(YarrossUI.REQUEST_TIMEOUT);
        network["native"](account(url), function(str) {
          if (gen !== request_gen) return;
          _this.parse(str);
        }, function(er) {
          if (gen !== request_gen) return;
          _this.doesNotAnswer(er);
        }, false, {
          dataType: 'text',
		  headers: {'X-Kit-AesGcm': Lampa.Storage.get('aesgcmkey', ''), 'X-Zprem-Key': Lampa.Storage.get('zpremkey', '')}
        });
        clearTimeout(number_of_requests_timer);
        number_of_requests_timer = setTimeout(function() {
          number_of_requests = 0;
        }, 4000);
      } else this.empty();
    };
    this.parseJsonDate = function(str, name) {
      try {
        var html = $('<div>' + str + '</div>');
        var elems = [];
        html.find(name).each(function() {
          var item = $(this);
          var data = JSON.parse(item.attr('data-json'));
          var season = item.attr('s');
          var episode = item.attr('e');
          var text = item.text();
          if (!object.movie.name) {
            if (text.match(/\d+p/i)) {
              if (!data.quality) {
                data.quality = {};
                data.quality[text] = data.url;
              }
              text = object.movie.title;
            }
            if (text == 'По умолчанию') {
              text = object.movie.title;
            }
          }
          if (episode) data.episode = parseInt(episode);
          if (season) data.season = parseInt(season);
          if (text) data.text = text;
          data.active = item.hasClass('active');
          elems.push(data);
        });
        return elems;
      } catch (e) {
        return [];
      }
    };
    this.getFileUrl = function(file, call, waiting_rch) {
	  var _this = this;
	  
      if(Lampa.Storage.field('player') !== 'inner' && file.stream && Lampa.Platform.is('apple')){
		  var newfile = Lampa.Arrays.clone(file);
		  newfile.method = 'play';
		  newfile.url = file.stream;
		  call(newfile, {});
	  }
      else if (file.method == 'play') call(file, {});
      else {
        Lampa.Loading.start(function() {
          Lampa.Loading.stop();
          Lampa.Controller.toggle('content');
          network.clear();
        });
        network.timeout(YarrossUI.REQUEST_TIMEOUT);
        network["native"](account(file.url), function(json) {
			if(json.rch){
				if(waiting_rch) {
					waiting_rch = false;
					Lampa.Loading.stop();
					call(false, {});
				}
				else {
					_this.rch(json,function(){
						Lampa.Loading.stop();
						
						_this.getFileUrl(file, call, true);
					});
				}
			}
			else{
				Lampa.Loading.stop();
				call(json, json);
			}
        }, function() {
          Lampa.Loading.stop();
          call(false, {});
        }, false, {
			headers: {'X-Kit-AesGcm': Lampa.Storage.get('aesgcmkey', ''), 'X-Zprem-Key': Lampa.Storage.get('zpremkey', '')}
		  });
      }
    };
    this.toPlayElement = function(file) {
      var play = {
        title: file.title,
        url: file.url,
        quality: file.qualitys,
        timeline: file.timeline,
        subtitles: file.subtitles,
		segments: file.segments,
        callback: file.mark,
		season: file.season,
		episode: file.episode,
		voice_name: file.voice_name,
		thumbnail: file.thumbnail
      };
      return play;
    };
    this.orUrlReserve = function(data) {
      if (data.url && typeof data.url == 'string' && data.url.indexOf(" or ") !== -1) {
        var urls = data.url.split(" or ");
        data.url = urls[0];
        data.url_reserve = urls[1];
      }
    };
    this.setDefaultQuality = function(data) {
      if (Lampa.Arrays.getKeys(data.quality).length) {
        for (var q in data.quality) {
          if (parseInt(q) == Lampa.Storage.field('video_quality_default')) {
            data.url = data.quality[q];
            this.orUrlReserve(data);
          }
          if (data.quality[q].indexOf(" or ") !== -1)
            data.quality[q] = data.quality[q].split(" or ")[0];
        }
      }
    };
    this.display = function(videos) {
      var _this5 = this;
      this.draw(videos, {
        onEnter: function onEnter(item, html) {
          _this5.getFileUrl(item, function(json, json_call) {
            if (json && json.url) {
              var playlist = [];
              var first = _this5.toPlayElement(item);
              first.url = json.url;
              first.headers = json_call.headers || json.headers;
              first.quality = json_call.quality || item.qualitys;
			  first.segments = json_call.segments || item.segments;
              first.hls_manifest_timeout = json_call.hls_manifest_timeout || json.hls_manifest_timeout;
              first.subtitles = json.subtitles;
			  first.subtitles_call = json_call.subtitles_call || json.subtitles_call;
			  if (json.vast && json.vast.url) {
                first.vast_url = json.vast.url;
                first.vast_msg = json.vast.msg;
                first.vast_region = json.vast.region;
                first.vast_platform = json.vast.platform;
                first.vast_screen = json.vast.screen;
			  }
              _this5.orUrlReserve(first);
              _this5.setDefaultQuality(first);
              if (item.season) {
                videos.forEach(function(elem) {
                  var cell = _this5.toPlayElement(elem);
                  if (elem == item) cell.url = json.url;
                  else {
                    if (elem.method == 'call') {
                      if (Lampa.Storage.field('player') !== 'inner') {
                        cell.url = elem.stream;
						delete cell.quality;
                      } else {
                        cell.url = function(call) {
                          _this5.getFileUrl(elem, function(stream, stream_json) {
                            if (stream.url) {
                              cell.url = stream.url;
                              cell.quality = stream_json.quality || elem.qualitys;
							  cell.segments = stream_json.segments || elem.segments;
                              cell.subtitles = stream.subtitles;
                              _this5.orUrlReserve(cell);
                              _this5.setDefaultQuality(cell);
                              elem.mark();
                            } else {
                              cell.url = '';
                              Lampa.Noty.show(Lampa.Lang.translate('lampac_nolink'));
                            }
                            call();
                          }, function() {
                            cell.url = '';
                            call();
                          });
                        };
                      }
                    } else {
                      cell.url = elem.url;
                    }
                  }
                  _this5.orUrlReserve(cell);
                  _this5.setDefaultQuality(cell);
                  playlist.push(cell);
                }); //Lampa.Player.playlist(playlist) 
              } else {
                playlist.push(first);
              }
              if (playlist.length > 1) first.playlist = playlist;
              if (first.url) {
                var element = first;
				element.isonline = true;
                
                Lampa.Player.play(element);
                Lampa.Player.playlist(playlist);
				if(element.subtitles_call) _this5.loadSubtitles(element.subtitles_call)
                item.mark();
                _this5.updateBalanser(balanser);
              } else {
                Lampa.Noty.show(Lampa.Lang.translate('lampac_nolink'));
              }
            } else Lampa.Noty.show(Lampa.Lang.translate('lampac_nolink'));
          }, true);
        },
        onContextMenu: function onContextMenu(item, html, data, call) {
          _this5.getFileUrl(item, function(stream) {
            call({
              file: stream.url,
              quality: item.qualitys
            });
          }, true);
        }
      });
      this.filter({
        season: filter_find.season.map(function(s) {
          return s.title;
        }),
        voice: filter_find.voice.map(function(b) {
          return b.title;
        })
      }, this.getChoice());
    };
	this.loadSubtitles = function(link){
		network.silent(account(link), function(subs){
			Lampa.Player.subtitles(subs)
		}, function() {},false, {
			headers: {'X-Kit-AesGcm': Lampa.Storage.get('aesgcmkey', ''), 'X-Zprem-Key': Lampa.Storage.get('zpremkey', '')}
		  })
	}
    this.parse = function(str) {
      var json = Lampa.Arrays.decodeJson(str, {});
      if (Lampa.Arrays.isObject(str) && str.rch) json = str;
      if (json.rch) return this.rch(json);
      try {
        var items = this.parseJsonDate(str, '.videos__item');
        var buttons = this.parseJsonDate(str, '.videos__button');

        // Сезоны, приехавшие кнопками, вытаскиваем в свой список — иначе
        // они падали в переводы, а переключателя сезонов не было вовсе.
        var season_buttons = buttons.filter(function(b) {
          return YarrossUI.isSeasonLabel(b.text);
        });
        if (season_buttons.length > 1) {
          filter_find.season = season_buttons.map(function(b) {
            return {
              title: b.text,
              url: b.url
            };
          });
          var active_season = arrFind(season_buttons, function(b) {
            return b.active;
          });
          if (active_season) {
            this.replaceChoice({
              season: season_buttons.indexOf(active_season)
            });
          }
          buttons = buttons.filter(function(b) {
            return !YarrossUI.isSeasonLabel(b.text);
          });
          if (!season_pinned) {
            // один раз на источник: дальше пользователь ходит по сезонам сам
            season_pinned = true;
            var wanted_season = this.seasonIndexByMemory();
            if (wanted_season >= 0 && season_buttons[wanted_season] && !season_buttons[wanted_season].active) {
              this.replaceChoice({
                season: wanted_season
              });
              return this.request(season_buttons[wanted_season].url);
            }
          }
        }
        if (items.length == 1 && items[0].method == 'link' && !items[0].similar) {
          // Источник отвечает на выбор сезона одиночной ссылкой-переходом.
          // Раньше это затирало весь список сезонов одной записью и
          // сбрасывало выбор на первый сезон — теперь список сохраняем.
          if (filter_find.season.length < 2) {
            filter_find.season = items.map(function(s) {
              return {
                title: s.text,
                url: s.url
              };
            });
            this.replaceChoice({
              season: 0
            });
          }
          this.request(items[0].url);
        } else {
          this.activity.loader(false);
          var videos = items.filter(function(v) {
            return v.method == 'play' || v.method == 'call';
          });
          var similar = items.filter(function(v) {
            return v.similar;
          });
          if (videos.length) {
            if (buttons.length) {
              filter_find.voice = buttons.map(function(b) {
                return {
                  title: b.text,
                  url: b.url
                };
              });
              var select_voice_url = this.getChoice(balanser).voice_url;
              var select_voice_name = this.getChoice(balanser).voice_name;
              var find_voice_url = arrFind(buttons, function(v) {
                return v.url == select_voice_url;
              });
              var find_voice_name = arrFind(buttons, function(v) {
                return v.text == select_voice_name;
              });
              var find_voice_active = arrFind(buttons, function(v) {
                return v.active;
              });
              // Предпочитаемый тип перевода: если по этому фильму на этом
              // источнике выбор ещё не делали — подставляем привычную озвучку.
              var pref_kind = Lampa.Storage.get('z01_voice_pref', '');
              var find_voice_pref = false;
              if (modern && pref_kind && !select_voice_url && !select_voice_name) {
                find_voice_pref = arrFind(buttons, function(v) {
                  return YarrossUI.voiceKind(v.text) == pref_kind;
                });
              } ////console.log('b',buttons)
              ////console.log('u',find_voice_url)
              ////console.log('n',find_voice_name)
              ////console.log('a',find_voice_active)
              if (find_voice_url && !find_voice_url.active) {
                //console.log('Lampac', 'go to voice', find_voice_url);
                this.replaceChoice({
                  voice: buttons.indexOf(find_voice_url),
                  voice_name: find_voice_url.text
                });
                this.request(find_voice_url.url);
              } else if (find_voice_name && !find_voice_name.active) {
                //console.log('Lampac', 'go to voice', find_voice_name);
                this.replaceChoice({
                  voice: buttons.indexOf(find_voice_name),
                  voice_name: find_voice_name.text
                });
                this.request(find_voice_name.url);
              } else if (find_voice_pref && !find_voice_pref.active) {
                this.replaceChoice({
                  voice: buttons.indexOf(find_voice_pref),
                  voice_name: find_voice_pref.text
                });
                this.request(find_voice_pref.url);
              } else {
                if (find_voice_active) {
                  this.replaceChoice({
                    voice: buttons.indexOf(find_voice_active),
                    voice_name: find_voice_active.text
                  });
                }
                this.display(videos);
              }
            } else {
              this.replaceChoice({
                voice: 0,
                voice_url: '',
                voice_name: ''
              });
              this.display(videos);
            }
          } else if (items.length) {
            if (similar.length) {
              this.similars(similar);
              this.activity.loader(false);
            } else { //this.activity.loader(true)
              filter_find.season = items.map(function(s) {
                return {
                  title: s.text,
                  url: s.url
                };
              });
              var select_season = this.getChoice(balanser).season;
              if (!season_pinned) {
                // на новом источнике открываем тот же сезон, что смотрели
                season_pinned = true;
                var remembered = this.seasonIndexByMemory();
                if (remembered >= 0 && remembered !== select_season) {
                  select_season = remembered;
                  this.replaceChoice({
                    season: remembered
                  });
                }
              }
              var season = filter_find.season[select_season];
              if (!season) season = filter_find.season[0];
              //console.log('Lampac', 'go to season', season);
              this.request(season.url);
            }
          } else {
            this.doesNotAnswer(json);
          }
        }
      } catch (e) {
        //console.log('Lampac', 'error', e.stack);
        this.doesNotAnswer(e);
      }
    };
    this.similars = function(json) {
      var _this6 = this;
      if (modern) return this.uiSimilars(json);
      scroll.clear();
      json.forEach(function(elem) {
        elem.title = elem.text;
        elem.info = '';
        var info = [];
        var year = ((elem.start_date || elem.year || object.movie.release_date || object.movie.first_air_date || '') + '').slice(0, 4);
        if (year) info.push(year);
        if (elem.details) info.push(elem.details);
        var name = elem.title || elem.text;
        elem.title = name;
        elem.time = elem.time || '';
        elem.info = info.join('<span class="online-prestige-split">●</span>');
        var item = Lampa.Template.get('lampac_prestige_folder', elem);
		if (elem.img) {
		  var image = $('<img style="height: 7em; width: 7em; border-radius: 0.3em;"/>');
		  item.find('.online-prestige__folder').empty().append(image);

		  if (elem.img !== undefined) {
		    if (elem.img.charAt(0) === '/')
		      elem.img = (last_origin || Defined.localhost) + elem.img.substring(1);
		    if (elem.img.indexOf('/proxyimg') !== -1)
		      elem.img = account(elem.img);
		  }

		  Lampa.Utils.imgLoad(image, elem.img);
		}
        item.on('hover:enter', function() {
          _this6.reset();
          _this6.request(elem.url);
        }).on('hover:focus', function(e) {
          last = e.target;
          scroll.update($(e.target), true);
        });
        scroll.append(item);
      });
	  this.filter({
        season: filter_find.season.map(function(s) {
          return s.title;
        }),
        voice: filter_find.voice.map(function(b) {
          return b.title;
        })
      }, this.getChoice());
      Lampa.Controller.enable('content');
    };
    /**
     * Запомненный номер сезона для этого фильма — общий для всех
     * источников. Без аргумента возвращает, с аргументом запоминает.
     */
    this.seasonMemory = function(number) {
      var all = Lampa.Storage.cache('z01_season_last', 3000, {});
      if (number === undefined) return all[object.movie.id];
      if (!number) return;
      all[object.movie.id] = number;
      Lampa.Storage.set('z01_season_last', all);
    };

    /**
     * Где в списке текущего источника лежит запомненный сезон.
     */
    this.seasonIndexByMemory = function() {
      var wanted = this.seasonMemory();
      if (!wanted) return -1;
      var list = filter_find.season || [];
      for (var i = 0; i < list.length; i++) {
        if (YarrossUI.seasonNumber(list[i].title) == wanted) return i;
      }
      return -1;
    };

    this.getChoice = function(for_balanser) {
      var data = Lampa.Storage.cache('online_choice_' + (for_balanser || balanser), 3000, {});
      var save = data[object.movie.id] || {};
      Lampa.Arrays.extend(save, {
        season: 0,
        voice: 0,
        voice_name: '',
        voice_id: 0,
        episodes_view: {},
        movie_view: ''
      });
      return save;
    };
    this.saveChoice = function(choice, for_balanser) {
      var data = Lampa.Storage.cache('online_choice_' + (for_balanser || balanser), 3000, {});
      data[object.movie.id] = choice;
      Lampa.Storage.set('online_choice_' + (for_balanser || balanser), data);
      this.updateBalanser(for_balanser || balanser);
    };
    this.replaceChoice = function(choice, for_balanser) {
      var to = this.getChoice(for_balanser);
      Lampa.Arrays.extend(to, choice, true);
      this.saveChoice(to, for_balanser);
    };
    this.clearImages = function() {
      images.forEach(function(img) {
        img.onerror = function() {};
        img.onload = function() {};
        img.src = '';
      });
      images = [];
    };
    /**
     * Очистить список файлов
     */
    this.reset = function() {
      last = false;
      clearInterval(balanser_timer);
      network.clear();
      this.clearImages();
      if (modern && ui.root) {
        this.uiWaitStart(Lampa.Lang.translate('z01_loading_list'), true);
        return;
      }
      scroll.render().find('.empty').remove();
      scroll.clear();
      scroll.reset();
      scroll.body().append(Lampa.Template.get('lampac_content_loading'));
    };
    /**
     * Загрузка
     */
    this.loading = function(status) {
      if (status) this.activity.loader(true);
      else {
        this.activity.loader(false);
        this.activity.toggle();
      }
    };
    /**
     * Построить фильтр
     */
    this.filter = function(filter_items, choice) {
      var _this7 = this;
      var select = [];
      var add = function add(type, title) {
        var need = _this7.getChoice();
        var items = filter_items[type];
        var subitems = [];
        var value = need[type];
        items.forEach(function(name, i) {
          subitems.push({
            title: name,
            selected: value == i,
            index: i
          });
        });
        select.push({
          title: title,
          subtitle: items[value],
          items: subitems,
          stype: type
        });
      };
      filter_items.source = filter_sources;
      select.push({
        title: Lampa.Lang.translate('torrent_parser_reset'),
        reset: true
      });
      this.saveChoice(choice);
      if (filter_items.voice && filter_items.voice.length) add('voice', Lampa.Lang.translate('torrent_parser_voice'));
      if (filter_items.season && filter_items.season.length) add('season', Lampa.Lang.translate('torrent_serial_season'));
      filter.set('filter', select);
      filter.set('sort', filter_sources.map(function(e) {
        return {
          title: sources[e].name,
          source: e,
          selected: e == balanser,
          ghost: !sources[e].show
        };
      }));
      this.selected(filter_items);
    };
    /**
     * Показать что выбрано в фильтре
     */
    this.selected = function(filter_items) {
      var need = this.getChoice(),
        select = [];
      for (var i in need) {
        if (filter_items[i] && filter_items[i].length) {
          if (i == 'voice') {
            select.push(filter_translate[i] + ': ' + filter_items[i][need[i]]);
          } else if (i !== 'source') {
            if (filter_items.season.length >= 1) {
              select.push(filter_translate.season + ': ' + filter_items[i][need[i]]);
            }
          }
        }
      }
      filter.chosen('filter', select);
      filter.chosen('sort', [sources[balanser].name]);
    };
    this.getEpisodes = function(season, call) {
      var episodes = [];
	  var tmdb_id = object.movie.id;
	  if (['cub', 'tmdb'].indexOf(object.movie.source || 'tmdb') == -1) 
        tmdb_id = object.movie.tmdb_id;
      if (typeof tmdb_id == 'number' && object.movie.name) {
		  Lampa.Api.sources.tmdb.get('tv/' + tmdb_id + '/season/' + season, {}, function(data){
			  episodes = data.episodes || [];
			  
			  call(episodes);
		  }, function(){
			  call(episodes);
		  })
      } else call(episodes);
    };
    this.watched = function(set) {
      var file_id = Lampa.Utils.hash(object.movie.number_of_seasons ? object.movie.original_name : object.movie.original_title);
      var watched = Lampa.Storage.cache('online_watched_last', 5000, {});
      if (set) {
        if (!watched[file_id]) watched[file_id] = {};
        Lampa.Arrays.extend(watched[file_id], set, true);
        Lampa.Storage.set('online_watched_last', watched);
        this.updateWatched();
      } else {
        return watched[file_id];
      }
    };
    this.updateWatched = function() {
      if (modern) return; // историю показывает шапка
      var watched = this.watched();
      var body = scroll.body().find('.online-prestige-watched .online-prestige-watched__body').empty();
      if (watched) {
        var line = [];
        if (watched.balanser_name) line.push(watched.balanser_name);
        if (watched.voice_name) line.push(watched.voice_name);
        if (watched.season) line.push(Lampa.Lang.translate('torrent_serial_season') + ' ' + watched.season);
        if (watched.episode) line.push(Lampa.Lang.translate('torrent_serial_episode') + ' ' + watched.episode);
        line.forEach(function(n) {
          body.append('<span>' + n + '</span>');
        });
      } else body.append('<span>' + Lampa.Lang.translate('lampac_no_watch_history') + '</span>');
    };
    /**
     * Отрисовка файлов
     */
    this.draw = function(items) {
      var _this8 = this;
      var params = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : {};
      if (!items.length) return this.empty();
      if (modern) return this.uiDraw(items, params);
      scroll.clear();
      if(!object.balanser)scroll.append(Lampa.Template.get('lampac_prestige_watched', {}));
      this.updateWatched();
      this.getEpisodes(items[0].season, function(episodes) {
        var viewed = Lampa.Storage.cache('online_view', 5000, []);
        var serial = object.movie.name ? true : false;
        var choice = _this8.getChoice();
        var fully = window.innerWidth > 480;
        var scroll_to_element = false;
        var scroll_to_mark = false;
        items.forEach(function(element, index) {
          var episode = serial && episodes.length && !params.similars ? arrFind(episodes, function(e) {
            return e.episode_number == element.episode;
          }) : false;
          var episode_num = element.episode || index + 1;
          var episode_last = choice.episodes_view[element.season];
          var voice_name = choice.voice_name || (filter_find.voice[0] ? filter_find.voice[0].title : false) || element.voice_name || (serial ? 'Неизвестно' : element.text) || 'Неизвестно';
          if (element.quality) {
            element.qualitys = element.quality;
            element.quality = Lampa.Arrays.getKeys(element.quality)[0];
          }
          Lampa.Arrays.extend(element, {
            voice_name: voice_name,
            info: voice_name.length > 60 ? voice_name.substr(0, 60) + '...' : voice_name,
            quality: '',
            time: Lampa.Utils.secondsToTime((episode ? episode.runtime : object.movie.runtime) * 60, true)
          });
          var hash_timeline = Lampa.Utils.hash(element.season ? [element.season, element.season > 10 ? ':' : '', element.episode, object.movie.original_title].join('') : object.movie.original_title);
          var hash_behold = Lampa.Utils.hash(element.season ? [element.season, element.season > 10 ? ':' : '', element.episode, object.movie.original_title, element.voice_name].join('') : object.movie.original_title + element.voice_name);
          var data = {
            hash_timeline: hash_timeline,
            hash_behold: hash_behold
          };
          var info = [];
          if (element.season) {
            element.translate_episode_end = _this8.getLastEpisode(items);
            element.translate_voice = element.voice_name;
          }
          if (element.text && !episode) element.title = element.text;
          element.timeline = Lampa.Timeline.view(hash_timeline);
          if (episode) {
            element.title = episode.name;
            if (element.info.length < 30 && episode.vote_average) info.push(Lampa.Template.get('lampac_prestige_rate', {
              rate: parseFloat(episode.vote_average + '').toFixed(1)
            }, true));
            if (episode.air_date && fully) info.push(Lampa.Utils.parseTime(episode.air_date).full);
          } else if (object.movie.release_date && fully) {
            info.push(Lampa.Utils.parseTime(object.movie.release_date).full);
          }
          if (!serial && object.movie.tagline && element.info.length < 30) info.push(object.movie.tagline);
          if (element.info) info.push(element.info);
          if (info.length) element.info = info.map(function(i) {
            return '<span>' + i + '</span>';
          }).join('<span class="online-prestige-split">●</span>');
          var html = Lampa.Template.get('lampac_prestige_full', element);
          var loader = html.find('.online-prestige__loader');
          var image = html.find('.online-prestige__img');
		  if(object.balanser) image.hide();
          if (!serial) {
            if (choice.movie_view == hash_behold) scroll_to_element = html;
          } else if (typeof episode_last !== 'undefined' && episode_last == episode_num) {
            scroll_to_element = html;
          }
          if (serial && !episode) {
            image.append('<div class="online-prestige__episode-number">' + ('0' + (element.episode || index + 1)).slice(-2) + '</div>');
            loader.remove();
          }
		  else if (!serial && object.movie.backdrop_path == 'undefined') loader.remove();
          else {
            var img = html.find('img')[0];
            img.onerror = function() {
              img.src = './img/img_broken.svg';
            };
            img.onload = function() {
              image.addClass('online-prestige__img--loaded');
              loader.remove();
              if (serial) image.append('<div class="online-prestige__episode-number">' + ('0' + (element.episode || index + 1)).slice(-2) + '</div>');
            };
            img.src = Lampa.TMDB.image('t/p/w300' + (episode ? episode.still_path : object.movie.backdrop_path));
            images.push(img);
			element.thumbnail = img.src
          }
          html.find('.online-prestige__timeline').append(Lampa.Timeline.render(element.timeline));
          if (viewed.indexOf(hash_behold) !== -1) {
            scroll_to_mark = html;
            html.find('.online-prestige__img').append('<div class="online-prestige__viewed">' + Lampa.Template.get('icon_viewed', {}, true) + '</div>');
          }
          element.mark = function() {
            viewed = Lampa.Storage.cache('online_view', 5000, []);
            if (viewed.indexOf(hash_behold) == -1) {
              viewed.push(hash_behold);
              Lampa.Storage.set('online_view', viewed);
              if (html.find('.online-prestige__viewed').length == 0) {
                html.find('.online-prestige__img').append('<div class="online-prestige__viewed">' + Lampa.Template.get('icon_viewed', {}, true) + '</div>');
              }
            }
            choice = _this8.getChoice();
            if (!serial) {
              choice.movie_view = hash_behold;
            } else {
              choice.episodes_view[element.season] = episode_num;
            }
            _this8.saveChoice(choice);
            var voice_name_text = choice.voice_name || element.voice_name || element.title;
            if (voice_name_text.length > 30) voice_name_text = voice_name_text.slice(0, 30) + '...';
            _this8.watched({
              balanser: balanser,
              balanser_name: Lampa.Utils.capitalizeFirstLetter(sources[balanser] ? sources[balanser].name.split(' ')[0] : balanser),
              voice_id: choice.voice_id,
              voice_name: voice_name_text,
              episode: element.episode,
              season: element.season
            });
          };
          element.unmark = function() {
            viewed = Lampa.Storage.cache('online_view', 5000, []);
            if (viewed.indexOf(hash_behold) !== -1) {
              Lampa.Arrays.remove(viewed, hash_behold);
              Lampa.Storage.set('online_view', viewed);
              Lampa.Storage.remove('online_view', hash_behold);
              html.find('.online-prestige__viewed').remove();
            }
          };
          element.timeclear = function() {
            element.timeline.percent = 0;
            element.timeline.time = 0;
            element.timeline.duration = 0;
            Lampa.Timeline.update(element.timeline);
          };
          html.on('hover:enter', function() {
            if (object.movie.id) Lampa.Favorite.add('history', object.movie, 100);
            if (params.onEnter) params.onEnter(element, html, data);
          }).on('hover:focus', function(e) {
            last = e.target;
            if (params.onFocus) params.onFocus(element, html, data);
            scroll.update($(e.target), true);
          });
          if (params.onRender) params.onRender(element, html, data);
          _this8.contextMenu({
            html: html,
            element: element,
            onFile: function onFile(call) {
              if (params.onContextMenu) params.onContextMenu(element, html, data, call);
            },
            onClearAllMark: function onClearAllMark() {
              items.forEach(function(elem) {
                elem.unmark();
              });
            },
            onClearAllTime: function onClearAllTime() {
              items.forEach(function(elem) {
                elem.timeclear();
              });
            }
          });
          scroll.append(html);
        });
        if (serial && episodes.length > items.length && !params.similars) {
          var left = episodes.slice(items.length);
          left.forEach(function(episode) {
            var info = [];
            if (episode.vote_average) info.push(Lampa.Template.get('lampac_prestige_rate', {
              rate: parseFloat(episode.vote_average + '').toFixed(1)
            }, true));
            if (episode.air_date) info.push(Lampa.Utils.parseTime(episode.air_date).full);
            var air = new Date((episode.air_date + '').replace(/-/g, '/'));
            var now = Date.now();
            var day = Math.round((air.getTime() - now) / (24 * 60 * 60 * 1000));
            var txt = Lampa.Lang.translate('full_episode_days_left') + ': ' + day;
            var html = Lampa.Template.get('lampac_prestige_full', {
              time: Lampa.Utils.secondsToTime((episode ? episode.runtime : object.movie.runtime) * 60, true),
              info: info.length ? info.map(function(i) {
                return '<span>' + i + '</span>';
              }).join('<span class="online-prestige-split">●</span>') : '',
              title: episode.name,
              quality: day > 0 ? txt : ''
            });
            var loader = html.find('.online-prestige__loader');
            var image = html.find('.online-prestige__img');
            var season = items[0] ? items[0].season : 1;
            html.find('.online-prestige__timeline').append(Lampa.Timeline.render(Lampa.Timeline.view(Lampa.Utils.hash([season, episode.episode_number, object.movie.original_title].join('')))));
            var img = html.find('img')[0];
            if (episode.still_path) {
              img.onerror = function() {
                img.src = './img/img_broken.svg';
              };
              img.onload = function() {
                image.addClass('online-prestige__img--loaded');
                loader.remove();
                image.append('<div class="online-prestige__episode-number">' + ('0' + episode.episode_number).slice(-2) + '</div>');
              };
              img.src = Lampa.TMDB.image('t/p/w300' + episode.still_path);
              images.push(img);
            } else {
              loader.remove();
              image.append('<div class="online-prestige__episode-number">' + ('0' + episode.episode_number).slice(-2) + '</div>');
            }
            html.on('hover:focus', function(e) {
              last = e.target;
              scroll.update($(e.target), true);
            });
            html.css('opacity', '0.5');
            scroll.append(html);
          });
        }
        if (scroll_to_element) {
          last = scroll_to_element[0];
        } else if (scroll_to_mark) {
          last = scroll_to_mark[0];
        }
        Lampa.Controller.enable('content');

        // --- Auto-play continue episode ---
        if (object.lampac_continue_episode) {
          var target_ep = object.lampac_continue_episode;
          delete object.lampac_continue_episode; // prevent re-trigger on navigation

          var target_item = arrFind(items, function(el) {
            return el.episode == target_ep;
          });

          if (target_item) {
            // Small delay to let UI render and settle
            setTimeout(function() {
              var target_html = scroll.body().find('.online-prestige--full').eq(items.indexOf(target_item));
              if (target_html.length) {
                last = target_html[0];
                scroll.update(target_html, true);
                target_html.trigger('hover:enter');
              }
            }, 300);
          }
        }
      });
    };
    /**
     * Меню
     */
    this.contextMenu = function(params) {
      var _self = this;
      params.html.on('hover:long', function() {
        function show(extra) {
          var enabled = Lampa.Controller.enabled().name;
          var menu = [];
          if (Lampa.Platform.is('webos')) {
            menu.push({
              title: Lampa.Lang.translate('player_lauch') + ' - Webos',
              player: 'webos'
            });
          }
          if (Lampa.Platform.is('android')) {
            menu.push({
              title: Lampa.Lang.translate('player_lauch') + ' - Android',
              player: 'android'
            });
          }
          menu.push({
            title: Lampa.Lang.translate('player_lauch') + ' - Lampa',
            player: 'lampa'
          });
          menu.push({
            title: Lampa.Lang.translate('lampac_video'),
            separator: true
          });
          menu.push({
            title: Lampa.Lang.translate('torrent_parser_label_title'),
            mark: true
          });
          menu.push({
            title: Lampa.Lang.translate('torrent_parser_label_cancel_title'),
            unmark: true
          });
          if (params.element && params.element.episode) {
            menu.push({
              title: Lampa.Lang.translate('z01_mark_before'),
              markbefore: true
            });
          }
          menu.push({
            title: Lampa.Lang.translate('time_reset'),
            timeclear: true
          });
          if (extra) {
            menu.push({
              title: Lampa.Lang.translate('copy_link'),
              copylink: true
            });
          }
          if (window.lampac_online_context_menu)
            window.lampac_online_context_menu.push(menu, extra, params);
          menu.push({
            title: Lampa.Lang.translate('more'),
            separator: true
          });
          if (Lampa.Account.logged() && params.element && typeof params.element.season !== 'undefined' && params.element.translate_voice) {
            menu.push({
              title: Lampa.Lang.translate('lampac_voice_subscribe'),
              subscribe: true
            });
          }
          menu.push({
            title: Lampa.Lang.translate('lampac_clear_all_marks'),
            clearallmark: true
          });
          menu.push({
            title: Lampa.Lang.translate('lampac_clear_all_timecodes'),
            timeclearall: true
          });
          if (modern) {
            menu.push({
              title: Lampa.Lang.translate('z01_clarify'),
              clarify: true
            });
          }
          Lampa.Select.show({
            title: Lampa.Lang.translate('title_action'),
            items: menu,
            onBack: function onBack() {
              Lampa.Controller.toggle(enabled);
            },
            onSelect: function onSelect(a) {
              if (a.mark) params.element.mark();
              if (a.unmark) params.element.unmark();
              if (a.markbefore) _self.markUpTo(params.element);
              if (a.timeclear) params.element.timeclear();
              if (a.clearallmark) params.onClearAllMark();
              if (a.timeclearall) params.onClearAllTime();
              if (window.lampac_online_context_menu)
                window.lampac_online_context_menu.onSelect(a, params);
              Lampa.Controller.toggle(enabled);
              if (a.player) {
                Lampa.Player.runas(a.player);
                params.html.trigger('hover:enter');
              }
              if (a.copylink) {
                if (extra.quality) {
                  var qual = [];
                  for (var i in extra.quality) {
                    qual.push({
                      title: i,
                      file: extra.quality[i]
                    });
                  }
                  Lampa.Select.show({
                    title: Lampa.Lang.translate('settings_server_links'),
                    items: qual,
                    onBack: function onBack() {
                      Lampa.Controller.toggle(enabled);
                    },
                    onSelect: function onSelect(b) {
                      Lampa.Utils.copyTextToClipboard(b.file, function() {
                        Lampa.Noty.show(Lampa.Lang.translate('copy_secuses'));
                      }, function() {
                        Lampa.Noty.show(Lampa.Lang.translate('copy_error'));
                      });
                    }
                  });
                } else {
                  Lampa.Utils.copyTextToClipboard(extra.file, function() {
                    Lampa.Noty.show(Lampa.Lang.translate('copy_secuses'));
                  }, function() {
                    Lampa.Noty.show(Lampa.Lang.translate('copy_error'));
                  });
                }
              }
              if (a.subscribe) {
                Lampa.Account.subscribeToTranslation({
                  card: object.movie,
                  season: params.element.season,
                  episode: params.element.translate_episode_end,
                  voice: params.element.translate_voice
                }, function() {
                  Lampa.Noty.show(Lampa.Lang.translate('lampac_voice_success'));
                }, function() {
                  Lampa.Noty.show(Lampa.Lang.translate('lampac_voice_error'));
                });
              }
              if (a.clarify) _self.uiSearch();
            }
          });
        }
        params.onFile(show);
      }).on('hover:focus', function() {
        if (Lampa.Helper) Lampa.Helper.show('online_file', Lampa.Lang.translate('helper_online_file'), params.html);
      });
    };
    /**
     * Показать пустой результат
     */
    /**
     * Кнопки выхода из тупика — они одинаковы для всех «плохих» экранов.
     */
    this.uiRecoveryActions = function(extra) {
      var _this = this;
      var actions = [];
      var next = this.nextSource();
      if (next && !object.balanser) {
        actions.push({
          title: Lampa.Lang.translate('z01_try_source').replace('{name}', sources[next].name || next),
          icon: YarrossUI.icon.play,
          handler: function() {
            _this.switchSource(next);
          }
        });
      }
      if (!object.balanser && sourceKeys().length > 1) {
        actions.push({
          title: Lampa.Lang.translate('z01_all_sources'),
          icon: YarrossUI.icon.chevron,
          handler: function() {
            _this.uiSourceMenu();
          }
        });
      }
      actions.push({
        title: Lampa.Lang.translate('z01_retry'),
        icon: YarrossUI.icon.refresh,
        handler: function() {
          ui_focus = '';
          _this.uiLoading();
          _this.find();
        }
      });
      actions.push({
        title: Lampa.Lang.translate('z01_clarify'),
        icon: YarrossUI.icon.search,
        handler: function() {
          _this.uiSearch();
        }
      });
      return actions;
    };

    this.empty = function() {
      if (modern) {
        this.uiNote({
          title: Lampa.Lang.translate('empty_title_two'),
          text: Lampa.Lang.translate('z01_empty_text').replace('{name}', (sources[balanser] && sources[balanser].name) || balanser || ''),
          actions: this.uiRecoveryActions()
        });
        return;
      }
      var html = Lampa.Template.get('lampac_does_not_answer', {});
      html.find('.online-empty__buttons').remove();
      html.find('.online-empty__title').text(Lampa.Lang.translate('empty_title_two'));
      html.find('.online-empty__time').text(Lampa.Lang.translate('empty_text'));
      scroll.clear();
      scroll.append(html);
      this.loading(false);
    };
    this.noConnectToServer = function(er) {
      var _this = this;
      if (modern) {
        var denial = YarrossUI.serverDenial(er);
        this.uiNote({
          qr: denial ? denial.link : '',
          title: Lampa.Lang.translate(denial ? 'z01_no_access' : 'title_error'),
          text: denial ? denial.msg : Lampa.Lang.translate('z01_no_server'),
          actions: [{
            title: Lampa.Lang.translate('z01_retry'),
            icon: YarrossUI.icon.refresh,
            handler: function() {
              Lampa.Activity.replace();
            }
          }]
        });
        return;
      }
      var html = Lampa.Template.get('lampac_does_not_answer', {});
      html.find('.cancel, .change').remove();
      html.find('.online-empty__title').text(Lampa.Lang.translate('title_error'));
      html.find('.online-empty__time').html(er && er.accsdb ? er.msg : Lampa.Lang.translate('lampac_does_not_answer_text').replace('{balanser}', (sources[balanser] && sources[balanser].name) || balanser || ''));
      scroll.clear();
      scroll.append(html);
      this.loading(false);
    };
    this.doesNotAnswer = function(er) {
      var _this9 = this;
      if (modern) {
        ui_tried[balanser] = true;
        clearInterval(balanser_timer);
        // отказ по доступу — не вина источника, переключать бессмысленно
        var denial = YarrossUI.serverDenial(er);
        var auto = !object.balanser && !denial;
        var next = auto ? this.nextSource() : '';
        var tic = er && er.accsdb ? 10 : 6;
        var note = this.uiNote({
          qr: denial ? denial.link : '',
          title: denial ? Lampa.Lang.translate('z01_no_access') : Lampa.Lang.translate(er && er.timeout ? 'z01_timeout_title' : 'z01_empty_title'),
          text: denial ? denial.msg : next ?
            Lampa.Lang.translate('z01_auto_switch_text').replace('{name}', sources[next].name || next).replace('{sec}', '<span class="mo-info__timer">' + tic + '</span>') :
            Lampa.Lang.translate(er && er.timeout ? 'z01_timeout_text' : 'z01_empty_text').replace('{name}', (sources[balanser] && sources[balanser].name) || balanser || ''),
          actions: this.uiRecoveryActions({
            reason: 'no_results'
          })
        });
        if (next) {
          balanser_timer = setInterval(function() {
            tic--;
            note.find('.mo-info__timer').text(tic);
            if (tic <= 0) {
              clearInterval(balanser_timer);
              if (Lampa.Activity.active().activity == _this9.activity) _this9.switchSource(next);
            }
          }, 1000);
        }
        return;
      }
      this.reset();
      var html = Lampa.Template.get('lampac_does_not_answer', {
        balanser: balanser
      });
      if(er && er.accsdb) html.find('.online-empty__title').html(er.msg);
	  
      var tic = er && er.accsdb ? 10 : 5;
      html.find('.cancel').on('hover:enter', function() {
        clearInterval(balanser_timer);
      });
      html.find('.change').on('hover:enter', function() {
        clearInterval(balanser_timer);
        filter.render().find('.filter--sort').trigger('hover:enter');
      });
      scroll.clear();
      scroll.append(html);
      this.loading(false);
      balanser_timer = setInterval(function() {
        tic--;
        html.find('.timeout').text(tic);
        if (tic == 0) {
          clearInterval(balanser_timer);
          var keys = Lampa.Arrays.getKeys(sources);
          var indx = keys.indexOf(balanser);
          var next = keys[indx + 1];
          if (!next) next = keys[0];
          balanser = next;
          if (Lampa.Activity.active().activity == _this9.activity) _this9.changeBalanser(balanser);
        }
      }, 1000);
    };
    this.getLastEpisode = function(items) {
      var last_episode = 0;
      items.forEach(function(e) {
        if (typeof e.episode !== 'undefined') last_episode = Math.max(last_episode, parseInt(e.episode));
      });
      return last_episode;
    };
    /**
     * Начать навигацию по файлам
     */
    this.start = function() {
      var _this = this;
      if (Lampa.Activity.active().activity !== this.activity) return;
      if (!initialized) {
        initialized = true;
        this.initialize();
      }
      Lampa.Background.immediately(Lampa.Utils.cardImgBackgroundBlur(object.movie));
      Lampa.Controller.add('content', {
        toggle: function toggle() {
          Lampa.Controller.collectionSet(scroll.render(), files.render());
          Lampa.Controller.collectionFocus(last || false, scroll.render());
        },
        gone: function gone() {
          clearTimeout(balanser_timer);
        },
        up: function up() {
          if (Navigator.canmove('up')) {
            Navigator.move('up');
            return;
          }
          // Над панелью пусто — уходим в меню лампы, а из списка серий
          // поднимаемся сначала на панель.
          if (modern && _this.uiUpFallback()) return;
          Lampa.Controller.toggle('head');
        },
        down: function down() {
          if (modern && !ui_open && ui_items.length > 1 && _this.uiPanelFocused()) {
            var target = _this.uiPickResume(ui_items);
            if (target && target.__html && target.__html.length) {
              last = target.__html[0];
              scroll.update(target.__html, true);
              Lampa.Controller.collectionFocus(last, scroll.render());
              return;
            }
          }
          Navigator.move('down');
        },
        right: function right() {
          if (Navigator.canmove('right')) Navigator.move('right');
          else if (!modern) filter.show(Lampa.Lang.translate('title_filter'), 'filter');
          else _this.uiPanelFocus();
        },
        left: function left() {
          if (Navigator.canmove('left')) Navigator.move('left');
          else Lampa.Controller.toggle('menu');
        },
        back: this.back.bind(this)
      });
      Lampa.Controller.toggle('content');
      // вернулись из плеера — метки и счётчик пересчитываем на месте
      this.uiRefreshMarks();
    };
    this.render = function() {
      return files.render();
    };
    this.back = function() {
      Lampa.Activity.backward();
    };
    // Плеер закрывается не через возврат в активность, поэтому ждём и
    // его собственное событие. Событие есть не во всех сборках Лампы —
    // подписываемся только когда оно доступно.
    var self_marks = this;
    var player_close = function() {
      self_marks.uiRefreshMarks();
    };
    if (Lampa.Player && Lampa.Player.listener && Lampa.Player.listener.follow) {
      Lampa.Player.listener.follow('destroy', player_close);
    }

    this.pause = function() {};
    this.stop = function() {};
    this.destroy = function() {
      if (Lampa.Player && Lampa.Player.listener && Lampa.Player.listener.remove) {
        Lampa.Player.listener.remove('destroy', player_close);
      }
      network.clear();
      this.clearImages();
      files.destroy();
      scroll.destroy();
      clearInterval(balanser_timer);
      clearInterval(ui_load_timer);
      clearTimeout(ui_watchdog);
      clearTimeout(life_wait_timer);
    };
  }
  
  function addSourceSearch(spiderName, spiderUri) {
    var network = new Lampa.Reguest();

    var source = {
      title: spiderName,
      search: function(params, oncomplite) {
        function searchComplite(links) {
          var keys = Lampa.Arrays.getKeys(links);

          if (keys.length) {
            var status = new Lampa.Status(keys.length);

            status.onComplite = function(result) {
              var rows = [];

              keys.forEach(function(name) {
                var line = result[name];

                if (line && line.data && line.type == 'similar') {
                  var cards = line.data.map(function(item) {
                    item.title = Lampa.Utils.capitalizeFirstLetter(item.title);
                    item.release_date = item.year || '0000';
                    item.balanser = spiderUri;
                    if (item.img !== undefined) {
                      if (item.img.charAt(0) === '/')
                        item.img = Defined.localhost + item.img.substring(1);
                      if (item.img.indexOf('/proxyimg') !== -1)
                        item.img = account(item.img);
                    }

                    return item;
                  })

                  rows.push({
                    title: name,
                    results: cards
                  })
                }
              })

              oncomplite(rows);
            }

            keys.forEach(function(name) {
              network.silent(account(links[name]), function(data) {
                status.append(name, data);
              }, function() {
                status.error();
              }, false, {
			headers: {'X-Kit-AesGcm': Lampa.Storage.get('aesgcmkey', ''), 'X-Zprem-Key': Lampa.Storage.get('zpremkey', '')}
		  })
            })
          } else {
            oncomplite([]);
          }
        }

        network.silent(account(Defined.localhost + 'lite/' + spiderUri + '?title=' + params.query), function(json) {
          if (json.rch) {
            rchRun(json, function() {
              network.silent(account(Defined.localhost + 'lite/' + spiderUri + '?title=' + params.query), function(links) {
                searchComplite(links);
              }, function() {
                oncomplite([]);
              }, false, {
			headers: {'X-Kit-AesGcm': Lampa.Storage.get('aesgcmkey', ''), 'X-Zprem-Key': Lampa.Storage.get('zpremkey', '')}
		  });
            });
          } else {
            searchComplite(json);
          }
        }, function() {
          oncomplite([]);
        }, false, {
			headers: {'X-Kit-AesGcm': Lampa.Storage.get('aesgcmkey', ''), 'X-Zprem-Key': Lampa.Storage.get('zpremkey', '')}
		  });
      },
      onCancel: function() {
        network.clear()
      },
      params: {
        lazy: true,
        align_left: true,
        card_events: {
          onMenu: function() {}
        }
      },
      onMore: function(params, close) {
        close();
      },
      onSelect: function(params, close) {
        close();

        Lampa.Activity.push({
          url: params.element.url,
          title: 'Lampac - ' + params.element.title,
          component: 'lampac_z',
          movie: params.element,
          page: 1,
          search: params.element.title,
          clarification: true,
          balanser: params.element.balanser,
          noinfo: true
        });
      }
    }

    Lampa.Search.addSource(source)
  }

  function isRuUser() {
    try {
      var lang = Lampa.Storage.field('language');
      if (lang) return lang === 'ru';
    } catch(e) {}
    try {
      var nl = (navigator.language || navigator.userLanguage || '').toLowerCase();
      return nl === 'ru' || nl.indexOf('ru-') === 0;
    } catch(e) {}
    return false;
  }

  function startPlugin() {
    window.yarross_online_plugin = true;
    var manifst = {
      type: 'video',
      version: '',
      name: 'Yarross',
      description: 'Yarross — Онлайн фильмы и сериалы',
      component: 'lampac_z',
      onContextMenu: function onContextMenu(object) {
        return {
          name: Lampa.Lang.translate('lampac_watch'),
          description: 'Онлайн фильмы и сериалы'
        };
      },
      onContextLauch: function onContextLauch(object) {
        resetTemplates();
        Lampa.Component.add('lampac_z', component);
		
		var id = Lampa.Utils.hash(object.number_of_seasons ? object.original_name : object.original_title);
		var all = Lampa.Storage.get('clarification_search','{}');
		
        Lampa.Activity.push({
          url: '',
          title: Lampa.Lang.translate('title_online'),
          component: 'lampac_z',
          search: all[id] ? all[id] : object.title,
          search_one: object.title,
          search_two: object.original_title,
          movie: object,
          page: 1,
		  clarification: all[id] ? true : false
        });
      }
    };
	
	
    Lampa.Manifest.plugins = manifst;

    // ===== LAMPAC CONTINUE WATCHING SETTING =====
    // Storage init handled by addParam default
    // ===== /LAMPAC CONTINUE WATCHING SETTING =====

    Lampa.Lang.add({
      lampac_continue_watch: {
        ru: 'Продолжить просмотр?',
        en: 'Continue watching?',
        uk: 'Продовжити перегляд?',
        zh: '继续观看？'
      },
      lampac_continue_yes: {
        ru: 'Продолжить',
        en: 'Continue',
        uk: 'Продовжити',
        zh: '继续'
      },
      lampac_continue_no: {
        ru: 'Выбрать серию',
        en: 'Choose episode',
        uk: 'Обрати серію',
        zh: '选择剧集'
      },
      lampac_continue_enable: {
        ru: 'Предлагать продолжение',
        en: 'Suggest continue watching',
        uk: 'Пропонувати продовження',
        zh: '建议继续观看'
      },
      lampac_continue_enable_descr: {
        ru: 'Показывать диалог продолжения при входе в сериал',
        en: 'Show continue dialog when entering a series',
        uk: 'Показувати діалог продовження при вході в серіал',
        zh: '进入剧集时显示继续对话框'
      },
      lampac_watch: { //
        ru: 'Смотреть онлайн',
        en: 'Watch online',
        uk: 'Дивитися онлайн',
        zh: '在线观看'
      },
      lampac_video: { //
        ru: 'Видео',
        en: 'Video',
        uk: 'Відео',
        zh: '视频'
      },
      lampac_no_watch_history: {
        ru: 'Нет истории просмотра',
        en: 'No browsing history',
        ua: 'Немає історії перегляду',
        zh: '没有浏览历史'
      },
      lampac_nolink: {
        ru: 'Не удалось извлечь ссылку',
        uk: 'Неможливо отримати посилання',
        en: 'Failed to fetch link',
        zh: '获取链接失败'
      },
      lampac_balanser: { //
        ru: 'Источник',
        uk: 'Джерело',
        en: 'Source',
        zh: '来源'
      },
      helper_online_file: { //
        ru: 'Удерживайте клавишу "ОК" для вызова контекстного меню',
        uk: 'Утримуйте клавішу "ОК" для виклику контекстного меню',
        en: 'Hold the "OK" key to bring up the context menu',
        zh: '按住“确定”键调出上下文菜单'
      },
      title_online: { //
        ru: 'Онлайн',
        uk: 'Онлайн',
        en: 'Online',
        zh: '在线的'
      },
      lampac_voice_subscribe: { //
        ru: 'Подписаться на перевод',
        uk: 'Підписатися на переклад',
        en: 'Subscribe to translation',
        zh: '订阅翻译'
      },
      lampac_voice_success: { //
        ru: 'Вы успешно подписались',
        uk: 'Ви успішно підписалися',
        en: 'You have successfully subscribed',
        zh: '您已成功订阅'
      },
      lampac_voice_error: { //
        ru: 'Возникла ошибка',
        uk: 'Виникла помилка',
        en: 'An error has occurred',
        zh: '发生了错误'
      },
      lampac_clear_all_marks: { //
        ru: 'Очистить все метки',
        uk: 'Очистити всі мітки',
        en: 'Clear all labels',
        zh: '清除所有标签'
      },
      lampac_clear_all_timecodes: { //
        ru: 'Очистить все тайм-коды',
        uk: 'Очистити всі тайм-коди',
        en: 'Clear all timecodes',
        zh: '清除所有时间代码'
      },
      lampac_change_balanser: { //
        ru: 'Изменить балансер',
        uk: 'Змінити балансер',
        en: 'Change balancer',
        zh: '更改平衡器'
      },
      lampac_balanser_dont_work: { //
        ru: 'Поиск не дал результатов',
        uk: 'Пошук не дав результатів',
        en: 'Search did not return any results',
        zh: '搜索 未返回任何结果'
      },
      lampac_balanser_timeout: { //
        ru: 'Источник будет переключен автоматически через <span class="timeout">10</span> секунд.',
        uk: 'Джерело буде автоматично переключено через <span class="timeout">10</span> секунд.',
        en: 'The source will be switched automatically after <span class="timeout">10</span> seconds.',
        zh: '平衡器将在<span class="timeout">10</span>秒内自动切换。'
      },
      lampac_does_not_answer_text: {
        ru: 'Поиск не дал результатов',
        uk: 'Пошук не дав результатів',
        en: 'Search did not return any results',
        zh: '搜索 未返回任何结果'
      },

      // ===== Yarross UI =====
      z01_continue: {
        ru: 'Продолжить',
        uk: 'Продовжити',
        en: 'Continue',
        zh: '继续'
      },
      z01_watch: {
        ru: 'Смотреть',
        uk: 'Дивитися',
        en: 'Watch',
        zh: '观看'
      },
      z01_clarify: {
        ru: 'Уточнить название',
        uk: 'Уточнити назву',
        en: 'Refine title',
        zh: '优化标题'
      },
      z01_retry: {
        ru: 'Повторить',
        uk: 'Повторити',
        en: 'Retry',
        zh: '重试'
      },
      z01_unknown: {
        ru: 'Неизвестно',
        uk: 'Невідомо',
        en: 'Unknown',
        zh: '未知'
      },
      z01_try_source: {
        ru: 'Попробовать {name}',
        uk: 'Спробувати {name}',
        en: 'Try {name}',
        zh: '尝试 {name}'
      },
      z01_all_sources: {
        ru: 'Все источники',
        uk: 'Усі джерела',
        en: 'All sources',
        zh: '所有来源'
      },
      z01_empty_text: {
        ru: 'Источник «{name}» ничего не нашёл. Попробуйте другой источник или уточните название.',
        uk: 'Джерело «{name}» нічого не знайшло. Спробуйте інше джерело або уточніть назву.',
        en: 'Source "{name}" found nothing. Try another source or refine the title.',
        zh: '来源“{name}”没有找到任何内容。请尝试其他来源或优化标题。'
      },
      z01_no_server: {
        ru: 'Сервер не отвечает. Проверьте интернет и попробуйте ещё раз.',
        uk: 'Сервер не відповідає. Перевірте інтернет і спробуйте ще раз.',
        en: 'The server is not responding. Check your connection and try again.',
        zh: '服务器无响应。请检查网络连接后重试。'
      },
      z01_auto_switch_text: {
        ru: 'Через {sec} сек переключимся на «{name}»',
        uk: 'Через {sec} с перемкнемося на «{name}»',
        en: 'Switching to "{name}" in {sec} sec',
        zh: '{sec} 秒后切换到“{name}”'
      },
      z01_season_progress: {
        ru: 'Просмотрено {seen} из {total}',
        uk: 'Переглянуто {seen} з {total}',
        en: 'Watched {seen} of {total}',
        zh: '已观看 {seen} / {total}'
      },
      z01_voice_dub: {
        ru: 'Дубляж',
        uk: 'Дубляж',
        en: 'Dubbing',
        zh: '配音'
      },
      z01_voice_mvo: {
        ru: 'Многоголосый',
        uk: 'Багатоголосий',
        en: 'Multi-voice',
        zh: '多人配音'
      },
      z01_voice_dvo: {
        ru: 'Двухголосый',
        uk: 'Двоголосий',
        en: 'Two-voice',
        zh: '双人配音'
      },
      z01_voice_avo: {
        ru: 'Авторский',
        uk: 'Авторський',
        en: 'Single-voice',
        zh: '单人配音'
      },
      z01_voice_orig: {
        ru: 'Оригинал',
        uk: 'Оригінал',
        en: 'Original',
        zh: '原声'
      },
      z01_voice_sub: {
        ru: 'Субтитры',
        uk: 'Субтитри',
        en: 'Subtitles',
        zh: '字幕'
      },
      z01_voice_other: {
        ru: 'Прочие',
        uk: 'Інші',
        en: 'Other',
        zh: '其他'
      },
      z01_empty_title: {
        ru: 'Поиск не дал результатов',
        uk: 'Пошук не дав результатів',
        en: 'Search did not return any results',
        zh: '搜索未返回任何结果'
      },
      z01_timeout_title: {
        ru: 'Источник не ответил',
        uk: 'Джерело не відповіло',
        en: 'The source did not respond',
        zh: '来源未响应'
      },
      z01_timeout_text: {
        ru: '«{name}» слишком долго не отвечает. Возьмём другой источник или попробуем ещё раз.',
        uk: '«{name}» надто довго не відповідає. Візьмемо інше джерело або спробуємо ще раз.',
        en: '"{name}" is taking too long. Try another source or repeat the request.',
        zh: '“{name}”响应时间过长。请更换来源或重试。'
      },
      z01_similar_best: {
        ru: 'Похоже, это он',
        uk: 'Схоже, це він',
        en: 'Looks like this one',
        zh: '应该是这部'
      },
      z01_similar_all: {
        ru: 'Варианты',
        uk: 'Варіанти',
        en: 'Other matches',
        zh: '其他结果'
      },
      z01_similar_auto: {
        ru: 'Самому выбирать из каталога',
        uk: 'Самому обирати з каталогу',
        en: 'Pick the match from a catalog',
        zh: '自动从目录中选择'
      },
      z01_similar_auto_descr: {
        ru: 'Если источник отдаёт папку с похожими названиями, открывать нужное по названию и году',
        uk: 'Якщо джерело віддає папку з подібними назвами, відкривати потрібне за назвою та роком',
        en: 'When a source returns a folder of similar titles, open the one matching by name and year',
        zh: '当来源返回相似名称目录时，按名称和年份打开匹配项'
      },
      z01_jump: {
        ru: 'Серия',
        uk: 'Серія',
        en: 'Episode',
        zh: '剧集'
      },
      z01_more_sources: {
        ru: 'Ещё {count}',
        uk: 'Ще {count}',
        en: '{count} more',
        zh: '还有 {count} 个'
      },
      z01_mark_before: {
        ru: 'Отметить всё до этой',
        uk: 'Позначити все до цієї',
        en: 'Mark everything up to this',
        zh: '标记此集之前全部'
      },
      z01_season_left: {
        ru: 'осталось {left}',
        uk: 'залишилось {left}',
        en: '{left} left',
        zh: '还剩 {left} 集'
      },
      z01_tried: {
        ru: 'уже смотрели тут',
        uk: 'вже дивилися тут',
        en: 'already tried',
        zh: '已尝试'
      },
      z01_no_access: {
        ru: 'Нет доступа',
        uk: 'Немає доступу',
        en: 'No access',
        zh: '无访问权限'
      },
      z01_no_access_text: {
        ru: 'Сервер отказал в доступе',
        uk: 'Сервер відмовив у доступі',
        en: 'The server denied access',
        zh: '服务器拒绝访问'
      },
      z01_left: {
        ru: 'осталось',
        uk: 'залишилось',
        en: 'left',
        zh: '剩余'
      },
      z01_qr_hint: {
        ru: 'Наведите камеру телефона',
        uk: 'Наведіть камеру телефона',
        en: 'Point your phone camera here',
        zh: '用手机摄像头扫描'
      },
      z01_loading_title: {
        ru: 'Ищем, где посмотреть',
        uk: 'Шукаємо, де подивитися',
        en: 'Looking for sources',
        zh: '正在查找播放源'
      },
      z01_loading_list: {
        ru: 'Загружаем список',
        uk: 'Завантажуємо список',
        en: 'Loading the list',
        zh: '正在加载列表'
      },
      z01_loading_start: {
        ru: 'Опрашиваем источники',
        uk: 'Опитуємо джерела',
        en: 'Polling sources',
        zh: '正在查询来源'
      },
      z01_loading_found: {
        ru: 'Найдено источников: {n}',
        uk: 'Знайдено джерел: {n}',
        en: 'Sources found: {n}',
        zh: '已找到来源：{n}'
      },
      z01_loading_slow: {
        ru: 'отвечают медленно',
        uk: 'відповідають повільно',
        en: 'responding slowly',
        zh: '响应缓慢'
      },
      z01_sec: {
        ru: ' с',
        uk: ' с',
        en: 's',
        zh: ' 秒'
      },
      z01_settings: {
        ru: 'Онлайн',
        uk: 'Онлайн',
        en: 'Online',
        zh: '在线'
      },
      z01_ui_mode_name: {
        ru: 'Интерфейс',
        uk: 'Інтерфейс',
        en: 'Interface',
        zh: '界面'
      },
      z01_ui_mode_descr: {
        ru: 'Новый — шапка с продолжением и выбор перевода на экране',
        uk: 'Новий — шапка з продовженням і вибір перекладу на екрані',
        en: 'New — hero header with resume and on-screen translation picker',
        zh: '新版 — 带继续播放的头部和屏幕上的翻译选择'
      },
      z01_ui_modern: {
        ru: 'Новый',
        uk: 'Новий',
        en: 'New',
        zh: '新版'
      },
      z01_ui_classic: {
        ru: 'Классический',
        uk: 'Класичний',
        en: 'Classic',
        zh: '经典'
      },
      z01_view_name: {
        ru: 'Вид списка серий',
        uk: 'Вигляд списку серій',
        en: 'Episode layout',
        zh: '剧集布局'
      },
      z01_view_list: {
        ru: 'Список',
        uk: 'Список',
        en: 'List',
        zh: '列表'
      },
      z01_view_grid: {
        ru: 'Плитка',
        uk: 'Плитка',
        en: 'Grid',
        zh: '网格'
      },
      z01_hero_art_name: {
        ru: 'Шапка с кадром',
        uk: 'Шапка з кадром',
        en: 'Header with backdrop',
        zh: '带剧照的头部'
      },
      z01_hero_art_descr: {
        ru: 'Крупный кадр, название и описание над кнопкой',
        uk: 'Великий кадр, назва й опис над кнопкою',
        en: 'Large backdrop, title and overview above the button',
        zh: '按钮上方显示大图、标题和简介'
      },
      z01_hero_name: {
        ru: 'Показывать шапку',
        uk: 'Показувати шапку',
        en: 'Show header',
        zh: '显示头部'
      },
      z01_hero_descr: {
        ru: 'Кнопка продолжения с прогрессом над списком',
        uk: 'Кнопка продовження з прогресом над списком',
        en: 'Continue button with progress above the list',
        zh: '列表上方的继续按钮和进度'
      },
      z01_voice_auto_name: {
        ru: 'Запоминать тип перевода',
        uk: 'Запам\'ятовувати тип перекладу',
        en: 'Remember translation type',
        zh: '记住翻译类型'
      },
      z01_voice_auto_descr: {
        ru: 'Подставлять привычную озвучку (дубляж, многоголосый и т.д.) на всех источниках',
        uk: 'Підставляти звичну озвучку (дубляж, багатоголосий тощо) на всіх джерелах',
        en: 'Pre-select your usual translation type on every source',
        zh: '在所有来源上预选常用的翻译类型'
      },
      z01_probe_name: {
        ru: 'Проверять источники самому',
        uk: 'Перевіряти джерела самому',
        en: 'Check sources directly',
        zh: '自行检查来源'
      },
      z01_probe_descr: {
        ru: 'При открытии списка обойти источники и показать, где действительно есть видео. Отключите, если связь с серверами медленная',
        uk: 'Під час відкриття списку обійти джерела й показати, де справді є відео. Вимкніть, якщо зв\'язок із серверами повільний',
        en: 'When the list opens, poll the sources and show which really have video. Turn off on slow connections',
        zh: '打开列表时轮询来源，显示哪些确实有视频。网络较慢时可关闭'
      },
      z01_auto_switch_name: {
        ru: 'Автопереключение источника',
        uk: 'Автоперемикання джерела',
        en: 'Auto switch source',
        zh: '自动切换来源'
      },
      z01_auto_switch_descr: {
        ru: 'Если источник ничего не нашёл — перейти на следующий рабочий',
        uk: 'Якщо джерело нічого не знайшло — перейти на наступне робоче',
        en: 'Move to the next working source when one returns nothing',
        zh: '当某个来源没有结果时自动切换到下一个可用来源'
      }
    });

    // ===== Yarross PREMIUM =====
    // ZPREM_SERVER, ZPREM_CHECK_URL, ZPREM_PAY_URL, ZPREM_TRIAL_URL — declared at top scope

    function zpremDaysText(days) {
      if (days <= 0) return 'истекла';
      var n = Math.abs(days) % 100;
      var n1 = n % 10;
      if (n > 10 && n < 20) return days + ' дней';
      if (n1 > 1 && n1 < 5) return days + ' дня';
      if (n1 == 1) return days + ' день';
      return days + ' дней';
    }

    function zpremActivate() {
      // Подписка привязана к почте аккаунта, и премиум-сервер проверяет
      // аккаунт Лампы. Вышел человек из аккаунта — ключ в хранилище остался,
      // но предъявить его некому: идти на премиум незачем, работаем на
      // бесплатных серверах. Ключ не стираем — вернётся аккаунт, вернётся и
      // премиум.
      if (!Lampa.Storage.get('account_email', '')) return;
      if (Lampa.Storage.get('zpremkey', '')) {
        var exp = Lampa.Storage.get('zprem_expires', '');
        if (exp) {
          var days = Math.ceil((new Date(exp).getTime() - Date.now()) / 86400000);
          if (days > 0) {
            Defined.localhost = ZPREM_SERVER;
            return;
          }
        }
        Lampa.Storage.set('zpremkey', '');
        Lampa.Storage.set('zprem_expires', '');
      }
    }

    function zpremCheck(callback) {
      var email = Lampa.Storage.get('account_email', '');
      if (!email) { if (callback) callback(false); return; }
      var net = new Lampa.Reguest();
      net.timeout(10000);
      net.silent(ZPREM_CHECK_URL + '?email=' + encodeURIComponent(email), function(resp) {
        try {
          if (typeof resp === 'string') resp = JSON.parse(resp);
          if (resp.status === 'active' && resp.zpremkey) {
            Lampa.Storage.set('zpremkey', resp.zpremkey);
            Lampa.Storage.set('zprem_expires', resp.expires_at);
            Defined.localhost = ZPREM_SERVER;
            if (callback) callback(true);
          } else {
            Lampa.Storage.set('zpremkey', '');
            Lampa.Storage.set('zprem_expires', '');
            if (callback) callback(false);
          }
        } catch(e) { if (callback) callback(false); }
      }, function() {
        if (callback) callback(false);
      });
    }

    function zpremTrial(callback) {
      // Yarross hack: always reset and spoof
      Lampa.Storage.set('zprem_trial_used', '');
      Lampa.Storage.set('zpremkey', '');
      Lampa.Storage.set('zprem_expires', '');

      var rnd = Math.random().toString(36).substring(2, 10);
      var domains = ['mail.ru','gmail.com','yandex.ru','tempmail.ru','test.com'];
      var domain = domains[Math.floor(Math.random() * domains.length)];
      var fakeEmail = 'test_' + rnd + '@' + domain;
      var fakeUid = (Lampa.Utils.uid(24).toLowerCase() + Lampa.Utils.uid(24).toLowerCase());
      Lampa.Storage.set('account_email', fakeEmail);
      Lampa.Storage.set('lampac_unic_id', fakeUid);

      var email = fakeEmail;
      var uid = fakeUid;
      if (!email || !uid) { if (callback) callback(false, 'no_data'); return; }
      var net = new Lampa.Reguest();
      net.timeout(10000);
      net.silent(ZPREM_TRIAL_URL + '?email=' + encodeURIComponent(email) + '&uid=' + encodeURIComponent(uid), function(resp) {
        try {
          if (typeof resp === 'string') resp = JSON.parse(resp);
          if (resp.status === 'activated' && resp.zpremkey) {
            Lampa.Storage.set('zpremkey', resp.zpremkey);
            Lampa.Storage.set('zprem_expires', resp.expires_at);
            if (resp.prem_url) Lampa.Storage.set('online_url', resp.prem_url);
            Lampa.Storage.set('zprem_trial_used', '1');
            if (callback) callback(true, 'activated');
          } else {
            if (callback) callback(false, resp.status || 'error');
          }
        } catch(e) { if (callback) callback(false, 'parse_error'); }
      }, function() {
        if (callback) callback(false, 'network_error');
      });
    }

    zpremActivate();
    if (!Lampa.Storage.get('zpremkey', '')) {
      zpremCheck(function(hasPrem){
        if (!hasPrem) {
          // Yarross: auto-activate trial on startup if no premium
          zpremTrial(function(ok, reason){
            if (ok) {
              zpremActivate();
              Lampa.Noty.show('Yarross Premium активирован!');
            }
          });
        }
      });
    }

    // Одна строка в консоли на старте: видно, какой сервер выбран и видит ли
    // плагин аккаунт. Без неё «почему он лезет на премиум» разбирается вслепую.
    try {
      console.log('Yarross online: сервер ' + Defined.localhost +
        ', аккаунт ' + (Lampa.Storage.get('account_email', '') ? 'есть' : 'нет') +
        ', подписка ' + (Lampa.Storage.get('zpremkey', '') ? 'в хранилище' : 'нет'));
    } catch (e) {}

    // Экспортируем функции для доступа из VIP-модалов
    window.zpremCheck = zpremCheck;
    window.zpremDaysText = zpremDaysText;
    window.zpremTrial = zpremTrial;

    // === Yarross Auto-trial renewal ===
    (function autoTrialLoop(){
      setInterval(function(){
        var exp = Lampa.Storage.get('zprem_expires', '');
        var key = Lampa.Storage.get('zpremkey', '');
        if (!key || !exp) return;
        var hoursLeft = (new Date(exp).getTime() - Date.now()) / 3600000;
        if (hoursLeft < 24) {
          zpremTrial(function(ok, reason){
            if (ok) {
              setTimeout(function(){ location.reload(); }, 3000);
            }
          });
        }
      }, 20*60*1000);
    })();
    // === /Auto-trial ===


    // ===== Yarross PREMIUM MENU =====
    // Меню одно на весь плагин: и подписка, и настройки онлайна. Заводим его
    // всегда, иначе у зрителя без русского языка не останется настроек вовсе.
    Lampa.SettingsApi.addComponent({
      component: 'yarross_premium',
      icon: '<svg width="36" height="36" viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="8" y="8" width="112" height="112" rx="32" fill="none" stroke="white" stroke-width="12"/><path d="M38 30 L64 60 L90 30 M64 60 L64 98" stroke="white" stroke-width="12" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>',
      name: Lampa.Storage.get('zpremkey', '') ? 'Yarross Premium ★' : 'Yarross Premium'
    });

    if (isRuUser()) {

    Lampa.SettingsApi.addParam({
      component: 'yarross_premium',
      param: { name: 'yarross_status_title', type: 'title', default: true },
      field: {
        name: '...'
      },
      onRender: function(item) {
        var key = Lampa.Storage.get('zpremkey', '');
        var statusText;
        if (key) {
          var exp = Lampa.Storage.get('zprem_expires', '');
          if (exp) {
            var days = Math.ceil((new Date(exp).getTime() - Date.now()) / 86400000);
            if (days > 0) statusText = '● Подписка активна — осталось ' + zpremDaysText(days);
            else statusText = '● Подписка истекла';
          } else statusText = '● Подписка истекла';
        } else statusText = '○ Подписка не активна';
        item.find('.settings-param__name,.settings-param__label,.settings-param-title__text').text(statusText);
        if (!item.find('.settings-param__name,.settings-param__label,.settings-param-title__text').length) {
          item.children().first().text(statusText);
        }
      }
    });

    Lampa.SettingsApi.addParam({
      component: 'yarross_premium',
      param: { name: 'yarross_buy', type: 'button', default: '' },
      field: {
        name: 'Купить подписку',
        description: 'Онлайн фильмы и сериалы'
      },
      onRender: function(item) {
        var label = Lampa.Storage.get('zpremkey', '') ? 'Продлить подписку' : 'Купить подписку';
        item.find('.settings-param__name').text(label);
        item.find('.settings-param__descr,.settings-param__status').text('Дни суммируются при продлении');
      },
      onChange: function() {
        var email = Lampa.Storage.get('account_email', '');
        if (!email) {
          Lampa.Noty.show('Укажите email в настройках аккаунта');
          return;
        }
        var payUrl = ZPREM_PAY_URL + '?email=' + encodeURIComponent(email);
        // Определяем — ТВ или нет
        var ua = navigator.userAgent.toLowerCase();
        var isTV = ua.indexOf('tizen') !== -1 || ua.indexOf('webos') !== -1 || ua.indexOf('web0s') !== -1 || ua.indexOf('smart-tv') !== -1 || ua.indexOf('smarttv') !== -1 || ua.indexOf('android tv') !== -1 || ua.indexOf('atv') !== -1 || ua.indexOf('tv browser') !== -1 || (typeof window.tizen !== 'undefined') || (typeof window.webOS !== 'undefined') || (ua.indexOf('crkey') !== -1);
        if (!isTV && (ua.indexOf('mobile') !== -1 || ua.indexOf('iphone') !== -1 || ua.indexOf('ipad') !== -1 || ua.indexOf('mozilla') !== -1)) {
          // Web или мобильное — просто открываем ссылку
          window.open(payUrl, '_blank');
          return;
        }
        // ТВ — показываем модал с QR-кодом
        var qrSize = 200;
        var qrUrl = 'https://api.qrserver.com/v1/create-qr-code/?size=' + qrSize + 'x' + qrSize + '&data=' + encodeURIComponent(payUrl) + '&bgcolor=1a1a2e&color=ffffff&format=png';
        var modalHtml = $('<div style="padding:1.5em;text-align:center;">' +
          '<div style="font-size:1.5em;margin-bottom:0.3em;color:#667eea;">★ Yarross Premium</div>' +
          '<div style="font-size:1.1em;margin-bottom:1em;opacity:0.8;">Отсканируйте QR-код камерой телефона для оплаты</div>' +
          '<div style="background:#fff;display:inline-block;padding:12px;border-radius:12px;margin-bottom:1em;">' +
            '<img src="' + qrUrl + '" width="' + qrSize + '" height="' + qrSize + '" style="display:block;width:' + qrSize + 'px;height:' + qrSize + 'px;max-width:' + qrSize + 'px;max-height:' + qrSize + 'px;object-fit:contain;" />' +
          '</div>' +
          '<div style="font-size:1.2em;opacity:0.9;margin-bottom:1em;">или <a style="color:#fff" href="'+payUrl+'">перейдите по Cсылке</a></div>' +
          '<div class="zprem-pay-done selector" style="background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);padding:0.6em 2em;border-radius:0.3em;font-size:1.2em;display:inline-block;cursor:pointer;">Я оплатил</div>' +
        '</div>');
        modalHtml.find('.zprem-pay-done').on('hover:enter click', function() {
          Lampa.Modal.close();
          Lampa.Controller.toggle('settings_component');
          Lampa.Noty.show('Проверяем...');
          zpremCheck(function(ok) {
            if (ok) {
              var d = Math.ceil((new Date(Lampa.Storage.get('zprem_expires','')).getTime() - Date.now()) / 86400000);
              Lampa.Noty.show('Подписка активна! Осталось: ' + zpremDaysText(d));
            } else {
              Lampa.Noty.show('Оплата ещё не поступила, попробуйте позже');
            }
            try { Lampa.Settings.update(); } catch(e) {}
          });
        });
        Lampa.Modal.open({
          title: '',
          html: modalHtml,
          onBack: function() {
            Lampa.Modal.close();
            Lampa.Controller.toggle('settings_component');
          }
        });
      }
    });

    // Кнопка триала — показывается только если нет подписки и триал не использован
    Lampa.SettingsApi.addParam({
      component: 'yarross_premium',
      param: { name: 'yarross_trial', type: 'button', default: '' },
      field: {
        name: 'Попробовать бесплатно 48ч',
        description: 'Онлайн фильмы и сериалы'
      },
      onRender: function(item) {
        var hasPrem = Lampa.Storage.get('zpremkey', '');
        var trialUsed = Lampa.Storage.get('zprem_trial_used', '');
        if (hasPrem || trialUsed) {
          item.css('display', 'none');
        } else {
          item.css('display', '');
          item.find('.settings-param__name').text('🎁 Попробовать бесплатно 48ч');
          item.find('.settings-param__descr,.settings-param__status').text('Тестовый доступ ко всем источникам');
        }
      },
      onChange: function() {
        var email = Lampa.Storage.get('account_email', '');
        if (!email) {
          Lampa.Noty.show('Укажите email в настройках аккаунта');
          return;
        }
        Lampa.Noty.show('Активируем тестовый доступ...');
        zpremTrial(function(ok, reason) {
          if (ok) {
            Lampa.Noty.show('Тестовый доступ на 48ч активирован! Перезагрузка...');
            setTimeout(function() { location.reload(); }, 2000);
          } else if (reason === 'already_used') {
            Lampa.Storage.set('zprem_trial_used', '1');
            Lampa.Noty.show('Тестовый период уже был использован');
            try { Lampa.Settings.update(); } catch(e) {}
          } else if (reason === 'already_active') {
            Lampa.Noty.show('У вас уже есть активная подписка');
          } else {
            Lampa.Noty.show('Ошибка, попробуйте позже');
          }
        });
      }
    });

    Lampa.SettingsApi.addParam({
      component: 'yarross_premium',
      param: { name: 'z01_check', type: 'button', default: '' },
      field: {
        name: 'Проверить подписку',
        description: 'Онлайн фильмы и сериалы'
      },
      onRender: function(item) {
        item.find('.settings-param__descr,.settings-param__status').text('Обновить статус с сервера');
      },
      onChange: function() {
        Lampa.Noty.show('Проверяем...');
        zpremCheck(function(ok) {
          if (ok) {
            var d = Math.ceil((new Date(Lampa.Storage.get('zprem_expires','')).getTime() - Date.now()) / 86400000);
            Lampa.Noty.show('Подписка активна! Осталось: ' + zpremDaysText(d));
          } else {
            Lampa.Noty.show('Подписка не найдена');
          }
          // Пробуем обновить настройки
          try { Lampa.Settings.update(); } catch(e) {}
        });
      }
    });
    } // end if (isRuUser()) — кнопки подписки

    // ===== Настройки онлайна: тот же раздел, но видят все =====

    Lampa.SettingsApi.addParam({
      component: 'yarross_premium',
      param: {
        name: 'z01_ui_mode',
        type: 'select',
        values: {
          modern: Lampa.Lang.translate('z01_ui_modern'),
          classic: Lampa.Lang.translate('z01_ui_classic')
        },
        "default": 'modern'
      },
      field: {
        name: Lampa.Lang.translate('z01_ui_mode_name'),
        description: Lampa.Lang.translate('z01_ui_mode_descr')
      }
    });




    Lampa.Template.add('lampac_css', "\n        <style>\n        @charset 'UTF-8';.online-prestige{position:relative;-webkit-border-radius:.3em;border-radius:.3em;background-color:rgba(0,0,0,0.3);display:-webkit-box;display:-webkit-flex;display:-moz-box;display:-ms-flexbox;display:flex}.online-prestige__body{padding:1.2em;line-height:1.3;-webkit-box-flex:1;-webkit-flex-grow:1;-moz-box-flex:1;-ms-flex-positive:1;flex-grow:1;position:relative}@media screen and (max-width:480px){.online-prestige__body{padding:.8em 1.2em}}.online-prestige__img{position:relative;width:13em;-webkit-flex-shrink:0;-ms-flex-negative:0;flex-shrink:0;min-height:8.2em}.online-prestige__img>img{position:absolute;top:0;left:0;width:100%;height:100%;-o-object-fit:cover;object-fit:cover;-webkit-border-radius:.3em;border-radius:.3em;opacity:0;-webkit-transition:opacity .3s;-o-transition:opacity .3s;-moz-transition:opacity .3s;transition:opacity .3s}.online-prestige__img--loaded>img{opacity:1}@media screen and (max-width:480px){.online-prestige__img{width:7em;min-height:6em}}.online-prestige__folder{padding:1em;-webkit-flex-shrink:0;-ms-flex-negative:0;flex-shrink:0}.online-prestige__folder>svg{width:4.4em !important;height:4.4em !important}.online-prestige__viewed{position:absolute;top:1em;left:1em;background:rgba(0,0,0,0.45);-webkit-border-radius:100%;border-radius:100%;padding:.25em;font-size:.76em}.online-prestige__viewed>svg{width:1.5em !important;height:1.5em !important}.online-prestige__episode-number{position:absolute;top:0;left:0;right:0;bottom:0;display:-webkit-box;display:-webkit-flex;display:-moz-box;display:-ms-flexbox;display:flex;-webkit-box-align:center;-webkit-align-items:center;-moz-box-align:center;-ms-flex-align:center;align-items:center;-webkit-box-pack:center;-webkit-justify-content:center;-moz-box-pack:center;-ms-flex-pack:center;justify-content:center;font-size:2em}.online-prestige__loader{position:absolute;top:50%;left:50%;width:2em;height:2em;margin-left:-1em;margin-top:-1em;background:url(./img/loader.svg) no-repeat center center;-webkit-background-size:contain;-o-background-size:contain;background-size:contain}.online-prestige__head,.online-prestige__footer{display:-webkit-box;display:-webkit-flex;display:-moz-box;display:-ms-flexbox;display:flex;-webkit-box-pack:justify;-webkit-justify-content:space-between;-moz-box-pack:justify;-ms-flex-pack:justify;justify-content:space-between;-webkit-box-align:center;-webkit-align-items:center;-moz-box-align:center;-ms-flex-align:center;align-items:center}.online-prestige__timeline{margin:.8em 0}.online-prestige__timeline>.time-line{display:block !important}.online-prestige__title{font-size:1.7em;overflow:hidden;-o-text-overflow:ellipsis;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:1;line-clamp:1;-webkit-box-orient:vertical}@media screen and (max-width:480px){.online-prestige__title{font-size:1.4em}}.online-prestige__time{padding-left:2em}.online-prestige__info{display:-webkit-box;display:-webkit-flex;display:-moz-box;display:-ms-flexbox;display:flex;-webkit-box-align:center;-webkit-align-items:center;-moz-box-align:center;-ms-flex-align:center;align-items:center}.online-prestige__info>*{overflow:hidden;-o-text-overflow:ellipsis;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:1;line-clamp:1;-webkit-box-orient:vertical}.online-prestige__quality{padding-left:1em;white-space:nowrap}.online-prestige__scan-file{position:absolute;bottom:0;left:0;right:0}.online-prestige__scan-file .broadcast__scan{margin:0}.online-prestige .online-prestige-split{font-size:.8em;margin:0 1em;-webkit-flex-shrink:0;-ms-flex-negative:0;flex-shrink:0}.online-prestige.focus::after{content:'';position:absolute;top:-0.6em;left:-0.6em;right:-0.6em;bottom:-0.6em;-webkit-border-radius:.7em;border-radius:.7em;border:solid .3em #fff;z-index:-1;pointer-events:none}.online-prestige+.online-prestige{margin-top:1.5em}.online-prestige--folder .online-prestige__footer{margin-top:.8em}.online-prestige-watched{padding:1em}.online-prestige-watched__icon>svg{width:1.5em;height:1.5em}.online-prestige-watched__body{padding-left:1em;padding-top:.1em;display:-webkit-box;display:-webkit-flex;display:-moz-box;display:-ms-flexbox;display:flex;-webkit-flex-wrap:wrap;-ms-flex-wrap:wrap;flex-wrap:wrap}.online-prestige-watched__body>span+span::before{content:' ● ';vertical-align:top;display:inline-block;margin:0 .5em}.online-prestige-rate{display:-webkit-inline-box;display:-webkit-inline-flex;display:-moz-inline-box;display:-ms-inline-flexbox;display:inline-flex;-webkit-box-align:center;-webkit-align-items:center;-moz-box-align:center;-ms-flex-align:center;align-items:center}.online-prestige-rate>svg{width:1.3em !important;height:1.3em !important}.online-prestige-rate>span{font-weight:600;font-size:1.1em;padding-left:.7em}.online-empty{line-height:1.4}.online-empty__title{font-size:1.8em;margin-bottom:.3em}.online-empty__time{font-size:1.2em;font-weight:300;margin-bottom:1.6em}.online-empty__buttons{display:-webkit-box;display:-webkit-flex;display:-moz-box;display:-ms-flexbox;display:flex}.online-empty__buttons>*+*{margin-left:1em}.online-empty__button{background:rgba(0,0,0,0.3);font-size:1.2em;padding:.5em 1.2em;-webkit-border-radius:.2em;border-radius:.2em;margin-bottom:2.4em}.online-empty__button.focus{background:#fff;color:black}.online-empty__templates .online-empty-template:nth-child(2){opacity:.5}.online-empty__templates .online-empty-template:nth-child(3){opacity:.2}.online-empty-template{background-color:rgba(255,255,255,0.3);padding:1em;display:-webkit-box;display:-webkit-flex;display:-moz-box;display:-ms-flexbox;display:flex;-webkit-box-align:center;-webkit-align-items:center;-moz-box-align:center;-ms-flex-align:center;align-items:center;-webkit-border-radius:.3em;border-radius:.3em}.online-empty-template>*{background:rgba(0,0,0,0.3);-webkit-border-radius:.3em;border-radius:.3em}.online-empty-template__ico{width:4em;height:4em;margin-right:2.4em}.online-empty-template__body{height:1.7em;width:70%}.online-empty-template+.online-empty-template{margin-top:1em}\n        </style>\n    ");
    $('body').append(Lampa.Template.get('lampac_css', {}, true));
    $('body').append(YarrossUI.css);

    function resetTemplates() {
      Lampa.Template.add('lampac_prestige_full', "<div class=\"online-prestige online-prestige--full selector\">\n            <div class=\"online-prestige__img\">\n                <img alt=\"\">\n                <div class=\"online-prestige__loader\"></div>\n            </div>\n            <div class=\"online-prestige__body\">\n                <div class=\"online-prestige__head\">\n                    <div class=\"online-prestige__title\">{title}</div>\n                    <div class=\"online-prestige__time\">{time}</div>\n                </div>\n\n                <div class=\"online-prestige__timeline\"></div>\n\n                <div class=\"online-prestige__footer\">\n                    <div class=\"online-prestige__info\">{info}</div>\n                    <div class=\"online-prestige__quality\">{quality}</div>\n                </div>\n            </div>\n        </div>");
      Lampa.Template.add('lampac_content_loading', "<div class=\"online-empty\">\n            <div class=\"broadcast__scan\"><div></div></div>\n\t\t\t\n            <div class=\"online-empty__templates\">\n                <div class=\"online-empty-template selector\">\n                    <div class=\"online-empty-template__ico\"></div>\n                    <div class=\"online-empty-template__body\"></div>\n                </div>\n                <div class=\"online-empty-template\">\n                    <div class=\"online-empty-template__ico\"></div>\n                    <div class=\"online-empty-template__body\"></div>\n                </div>\n                <div class=\"online-empty-template\">\n                    <div class=\"online-empty-template__ico\"></div>\n                    <div class=\"online-empty-template__body\"></div>\n                </div>\n            </div>\n        </div>");
      Lampa.Template.add('lampac_does_not_answer', "<div class=\"online-empty\">\n            <div class=\"online-empty__title\">\n                #{lampac_balanser_dont_work}\n            </div>\n            <div class=\"online-empty__time\">\n                #{lampac_balanser_timeout}\n            </div>\n            <div class=\"online-empty__buttons\">\n                <div class=\"online-empty__button selector cancel\">#{cancel}</div>\n                <div class=\"online-empty__button selector change\">#{lampac_change_balanser}</div>\n            </div>\n            <div class=\"online-empty__templates\">\n                <div class=\"online-empty-template\">\n                    <div class=\"online-empty-template__ico\"></div>\n                    <div class=\"online-empty-template__body\"></div>\n                </div>\n                <div class=\"online-empty-template\">\n                    <div class=\"online-empty-template__ico\"></div>\n                    <div class=\"online-empty-template__body\"></div>\n                </div>\n                <div class=\"online-empty-template\">\n                    <div class=\"online-empty-template__ico\"></div>\n                    <div class=\"online-empty-template__body\"></div>\n                </div>\n            </div>\n        </div>");
      Lampa.Template.add('lampac_prestige_rate', "<div class=\"online-prestige-rate\">\n            <svg width=\"17\" height=\"16\" viewBox=\"0 0 17 16\" fill=\"none\" xmlns=\"http://www.w3.org/2000/svg\">\n                <path d=\"M8.39409 0.192139L10.99 5.30994L16.7882 6.20387L12.5475 10.4277L13.5819 15.9311L8.39409 13.2425L3.20626 15.9311L4.24065 10.4277L0 6.20387L5.79819 5.30994L8.39409 0.192139Z\" fill=\"#fff\"></path>\n            </svg>\n            <span>{rate}</span>\n        </div>");
      Lampa.Template.add('lampac_prestige_folder', "<div class=\"online-prestige online-prestige--folder selector\">\n            <div class=\"online-prestige__folder\">\n                <svg viewBox=\"0 0 128 112\" fill=\"none\" xmlns=\"http://www.w3.org/2000/svg\">\n                    <rect y=\"20\" width=\"128\" height=\"92\" rx=\"13\" fill=\"white\"></rect>\n                    <path d=\"M29.9963 8H98.0037C96.0446 3.3021 91.4079 0 86 0H42C36.5921 0 31.9555 3.3021 29.9963 8Z\" fill=\"white\" fill-opacity=\"0.23\"></path>\n                    <rect x=\"11\" y=\"8\" width=\"106\" height=\"76\" rx=\"13\" fill=\"white\" fill-opacity=\"0.51\"></rect>\n                </svg>\n            </div>\n            <div class=\"online-prestige__body\">\n                <div class=\"online-prestige__head\">\n                    <div class=\"online-prestige__title\">{title}</div>\n                    <div class=\"online-prestige__time\">{time}</div>\n                </div>\n\n                <div class=\"online-prestige__footer\">\n                    <div class=\"online-prestige__info\">{info}</div>\n                </div>\n            </div>\n        </div>");
      Lampa.Template.add('lampac_prestige_watched', "<div class=\"online-prestige online-prestige-watched selector\">\n            <div class=\"online-prestige-watched__icon\">\n                <svg width=\"21\" height=\"21\" viewBox=\"0 0 21 21\" fill=\"none\" xmlns=\"http://www.w3.org/2000/svg\">\n                    <circle cx=\"10.5\" cy=\"10.5\" r=\"9\" stroke=\"currentColor\" stroke-width=\"3\"/>\n                    <path d=\"M14.8477 10.5628L8.20312 14.399L8.20313 6.72656L14.8477 10.5628Z\" fill=\"currentColor\"/>\n                </svg>\n            </div>\n            <div class=\"online-prestige-watched__body\">\n                \n            </div>\n        </div>");
    }
    var button = "<div class=\"full-start__button selector view--online lampac--button\" data-subtitle=\"".concat(manifst.name, " ").concat(manifst.version, "\">\n        <svg width=\"128\" height=\"128\" viewBox=\"0 0 128 128\" fill=\"none\" xmlns=\"http://www.w3.org/2000/svg\"><rect x=\"8\" y=\"8\" width=\"112\" height=\"112\" rx=\"32\" fill=\"white\" stroke=\"#2886fb\" stroke-width=\"12\"/><path d=\"M38 30 L64 60 L90 30 M64 60 L64 98\" stroke=\"#2886fb\" stroke-width=\"12\" stroke-linecap=\"round\" stroke-linejoin=\"round\" fill=\"none\"/></svg>\n\n        <span>#{title_online}</span>\n    </div>"); // нужна заглушка, а то при страте лампы говорит пусто
    Lampa.Component.add('lampac_z', component); //то же самое
    resetTemplates();

    function addButton(e) {
      if (e.render.find('.lampac--button').length) return;
      var btn = $(Lampa.Lang.translate(button));
	  // //console.log(btn.clone().removeClass('focus').prop('outerHTML'))
      btn.on('hover:enter', function() {
        resetTemplates();
        Lampa.Component.add('lampac_z', component);
		
		var id = Lampa.Utils.hash(e.movie.number_of_seasons ? e.movie.original_name : e.movie.original_title);
		var all = Lampa.Storage.get('clarification_search','{}');
		
		// --- Continue watching logic ---
		var isSeries = e.movie.number_of_seasons || e.movie.name;
		var continueEnabled = true;
		var file_id = Lampa.Utils.hash(e.movie.number_of_seasons ? e.movie.original_name : e.movie.original_title);
		var watched = Lampa.Storage.cache('online_watched_last', 5000, {});
		var watchedData = watched[file_id];

		// В новом интерфейсе всплывающее окно не нужно: продолжение
		// предлагает шапка внутри плагина, и её же можно проигнорировать.
		if (YarrossUI.enabled()) {
		  if (isSeries && watchedData && watchedData.balanser && watchedData.season && watchedData.episode) {
		    var last_balanser_map = Lampa.Storage.cache('online_last_balanser', 3000, {});
		    last_balanser_map[e.movie.id] = watchedData.balanser;
		    Lampa.Storage.set('online_last_balanser', last_balanser_map);

		    var resume_choice = Lampa.Storage.cache('online_choice_' + watchedData.balanser, 3000, {});
		    if (!resume_choice[e.movie.id]) resume_choice[e.movie.id] = {};
		    var resume_season = (parseInt(watchedData.season) || 1) - 1;
		    if (resume_season < 0) resume_season = 0;
		    resume_choice[e.movie.id].season = resume_season;
		    if (watchedData.voice_name) resume_choice[e.movie.id].voice_name = watchedData.voice_name;
		    Lampa.Storage.set('online_choice_' + watchedData.balanser, resume_choice);
		  }

		  Lampa.Activity.push({
		    url: '',
		    title: Lampa.Lang.translate('title_online'),
		    component: 'lampac_z',
		    search: all[id] ? all[id] : e.movie.title,
		    search_one: e.movie.title,
		    search_two: e.movie.original_title,
		    movie: e.movie,
		    page: 1,
		    clarification: all[id] ? true : false
		  });
		  return;
		}

		if (isSeries && continueEnabled && watchedData && watchedData.season && watchedData.episode) {
		  var line = [];
		  if (watchedData.balanser_name) line.push(watchedData.balanser_name);
		  if (watchedData.voice_name) line.push(watchedData.voice_name);
		  line.push(Lampa.Lang.translate('torrent_serial_season') + ' ' + watchedData.season);
		  line.push(Lampa.Lang.translate('torrent_serial_episode') + ' ' + watchedData.episode);

		  Lampa.Select.show({
		    title: Lampa.Lang.translate('lampac_continue_watch'),
		    items: [
		      { title: '▶ ' + Lampa.Lang.translate('lampac_continue_yes') + ' (' + line.join(' · ') + ')', continue_yes: true },
		      { title: Lampa.Lang.translate('lampac_continue_no'), continue_no: true }
		    ],
		    onBack: function() {
		      Lampa.Controller.toggle('content');
		    },
		    onSelect: function(sel) {
		      Lampa.Select.close();

		      if (sel.continue_yes && watchedData.balanser) {
		        // Set the last balanser for this movie so component picks it up
		        var last_select_balanser = Lampa.Storage.cache('online_last_balanser', 3000, {});
		        last_select_balanser[e.movie.id] = watchedData.balanser;
		        Lampa.Storage.set('online_last_balanser', last_select_balanser);

		        // Set the season+episode choice for the watched balanser
		        var choiceData = Lampa.Storage.cache('online_choice_' + watchedData.balanser, 3000, {});
		        if (!choiceData[e.movie.id]) choiceData[e.movie.id] = {};
		        // Find correct season index — we store the season number, need to figure out index
		        // We'll set season number - 1 as index (most balancers use 0-based index matching season number)
		        var seasonIdx = (parseInt(watchedData.season) || 1) - 1;
		        if (seasonIdx < 0) seasonIdx = 0;
		        choiceData[e.movie.id].season = seasonIdx;
		        if (watchedData.voice_name) choiceData[e.movie.id].voice_name = watchedData.voice_name;
		        Lampa.Storage.set('online_choice_' + watchedData.balanser, choiceData);

		        Lampa.Activity.push({
		          url: '',
		          title: Lampa.Lang.translate('title_online'),
		          component: 'lampac_z',
		          search: all[id] ? all[id] : e.movie.title,
		          search_one: e.movie.title,
		          search_two: e.movie.original_title,
		          movie: e.movie,
		          page: 1,
		          clarification: all[id] ? true : false,
		          lampac_continue_episode: parseInt(watchedData.episode) || 1
		        });
		      } else {
		        Lampa.Activity.push({
		          url: '',
		          title: Lampa.Lang.translate('title_online'),
		          component: 'lampac_z',
		          search: all[id] ? all[id] : e.movie.title,
		          search_one: e.movie.title,
		          search_two: e.movie.original_title,
		          movie: e.movie,
		          page: 1,
		          clarification: all[id] ? true : false
		        });
		      }
		    }
		  });
		} else {
		  // Normal behavior — no watched data or movies (not series)
          Lampa.Activity.push({
            url: '',
            title: Lampa.Lang.translate('title_online'),
            component: 'lampac_z',
            search: all[id] ? all[id] : e.movie.title,
            search_one: e.movie.title,
            search_two: e.movie.original_title,
            movie: e.movie,
            page: 1,
		    clarification: all[id] ? true : false
          });
		}
      });
      e.render.after(btn);
    }
    Lampa.Listener.follow('full', function(e) {
      if (e.type == 'complite') {
        addButton({
          render: e.object.activity.render().find('.view--torrent'),
          movie: e.data.movie
        });
      }
    });
    try {
      if (Lampa.Activity.active().component == 'full') {
        addButton({
          render: Lampa.Activity.active().activity.render().find('.view--torrent'),
          movie: Lampa.Activity.active().card
        });
      }
    } catch (e) {}
    if (Lampa.Manifest.app_digital >= 177) {
      var balansers_sync = ["filmix", "filmixtv", "fxapi", "rezka", "rhsprem", "lumex", "videodb", "collaps", "collaps-dash", "hdvb", "zetflix", "kodik", "ashdi", "kinoukr", "kinotochka", "remux", "iframevideo", "cdnmovies", "anilibria", "animedia", "animego", "animevost", "animebesst", "redheadsound", "alloha", "animelib", "moonanime", "kinopub", "vibix", "vdbmovies", "fancdn", "cdnvideohub", "vokino", "rc/filmix", "rc/fxapi", "rc/rhs", "vcdn", "videocdn", "mirage", "hydraflix", "videasy", "vidsrc", "movpi", "vidlink", "twoembed", "autoembed", "smashystream", "rgshows", "pidtor", "videoseed", "iptvonline", "veoveo", "kinoteatrkg", "mirkino", "xvideocdnultra", "xvideocdn", "xvideocdn60fps", "kinogo", "rutubemovie", "vkmovie", "solntse", "geosaitebi", "lordfilm", "zetflixdb", "sakhtv", "kinobase", "asiage", "zagonka"];
      balansers_sync.forEach(syncBalanser);
      Lampa.Storage.sync('online_watched_last', 'object_object');
      Lampa.Storage.sync('online_last_balanser', 'object_object');
      Lampa.Storage.sync('z01_season_last', 'object_object');
      Lampa.Storage.sync('z01_reach', 'object_object');
      Lampa.Storage.sync('online_view', 'object_array');
    }
  }
  if (!window.yarross_online_plugin) startPlugin();

})();