/**
 * ReservaFácil — sistema de turnos con Google Sheets + Apps Script
 *
 * Página del cliente:  URL de la aplicación web
 * Panel del dueño:     URL de la aplicación web + ?p=admin
 *
 * Primera vez: ejecutá la función "setup" una sola vez desde el editor.
 */

const TZ = 'America/Argentina/Buenos_Aires';
const HOJA_TURNOS = 'Turnos';
const HOJA_CONFIG = 'Config';
const COLS = ['ID', 'Fecha', 'Hora', 'Nombre', 'Celular', 'Origen', 'Aviso', 'Avisado', 'Estado', 'Creado'];
const NOMBRES_DIA = ['', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

const CONFIG_INICIAL = [
  ['Clave', 'Valor', 'Para qué sirve'],
  ['Negocio', 'ReservaFácil', 'Nombre que ve el cliente arriba de la página'],
  ['PrimerTurno', '09:00', 'Horario del primer turno del día (HH:MM)'],
  ['UltimoTurno', '18:00', 'Horario del último turno que se puede reservar (HH:MM)'],
  ['MinutosPorTurno', '30', 'Cada cuántos minutos hay un turno'],
  ['DiasDeAtencion', '1,2,3,4,5,6', 'Días que se atiende: 1=lunes, 2=martes ... 6=sábado, 7=domingo'],
  ['DiasParaAdelante', '14', 'Cuántos días para adelante se pueden reservar'],
  ['AnticipacionMinutos', '120', 'Con cuánta anticipación mínima puede reservar el cliente'],
  ['ClaveDueno', 'cambiar-esta-clave', 'Clave para entrar al panel del dueño. ¡Cambiala!'],
  ['WhatsAppNegocio', '', 'Celular del negocio, ej: 5491123456789 (sin 0 ni 15). Vacío = sin botón'],
];

/* ============ Instalación ============ */

function setup() {
  const ss = SpreadsheetApp.getActive();

  const t = ss.getSheetByName(HOJA_TURNOS) || ss.insertSheet(HOJA_TURNOS);
  if (t.getLastRow() === 0) {
    t.getRange(1, 1, 1, COLS.length).setValues([COLS]).setFontWeight('bold');
    t.setFrozenRows(1);
  }
  // Repara filas viejas: deja ID, Fecha y Hora como texto (ej. "09:00", no 9:00)
  if (t.getLastRow() > 1) {
    const filas = leerTurnos_();
    t.getRange(2, 1, filas.length, 3).setNumberFormat('@')
      .setValues(filas.map(f => [f.id, f.fecha, f.hora]));
  }
  t.getRange(1, 1, t.getMaxRows(), COLS.length).setNumberFormat('@');
  ss.setSpreadsheetTimeZone(TZ);

  const c = ss.getSheetByName(HOJA_CONFIG) || ss.insertSheet(HOJA_CONFIG);
  c.getRange(1, 1, c.getMaxRows(), 3).setNumberFormat('@');
  if (c.getLastRow() === 0) {
    c.getRange(1, 1, CONFIG_INICIAL.length, 3).setValues(CONFIG_INICIAL);
    c.getRange(1, 1, 1, 3).setFontWeight('bold');
    c.setFrozenRows(1);
    c.autoResizeColumns(1, 3);
  }

  const sobrante = ss.getSheetByName('Hoja 1') || ss.getSheetByName('Sheet1');
  if (sobrante && sobrante.getLastRow() === 0 && ss.getSheets().length > 2) ss.deleteSheet(sobrante);
}

/* ============ Páginas ============ */

function doGet(e) {
  const cfg = getConfig_();
  const esAdmin = e && e.parameter && e.parameter.p === 'admin';
  const t = HtmlService.createTemplateFromFile(esAdmin ? 'Admin' : 'Reservar');
  t.negocio = cfg.Negocio || 'ReservaFácil';
  return t.evaluate()
    .setTitle(t.negocio + (esAdmin ? ' · Panel' : ' · Reservá tu turno'))
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function include(nombre) {
  return HtmlService.createHtmlOutputFromFile(nombre).getContent();
}

/* ============ API del cliente ============ */

function apiDias() {
  const cfg = getConfig_();
  const turnos = leerTurnos_();
  const antic = Number(cfg.AnticipacionMinutos) || 0;
  return proximosDias_(cfg)
    .map(d => Object.assign(d, { libres: libres_(cfg, d.fecha, turnos, antic).length }))
    .filter(d => d.libres > 0);
}

function apiHorarios(fecha) {
  const cfg = getConfig_();
  if (!diaValido_(cfg, fecha)) return [];
  return libres_(cfg, fecha, leerTurnos_(), Number(cfg.AnticipacionMinutos) || 0);
}

function apiReservar(d) {
  const cfg = getConfig_();
  const nombre = limpiar_(d && d.nombre, 60);
  const celular = limpiar_(d && d.celular, 20);
  if (!d || !diaValido_(cfg, d.fecha)) return { ok: false, msg: 'Ese día no está disponible.' };
  if (nombre.length < 2) return { ok: false, msg: 'El nombre es muy corto.' };
  if (!celValido_(celular)) return { ok: false, msg: 'Revisá el celular: solo números, por ejemplo 11 2345 6789.' };

  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const libres = libres_(cfg, d.fecha, leerTurnos_(), Number(cfg.AnticipacionMinutos) || 0);
    if (libres.indexOf(d.hora) === -1) {
      return { ok: false, ocupado: true, msg: 'Ese horario se acaba de ocupar. Elegí otro.' };
    }
    agregarTurno_(d.fecha, d.hora, nombre, celular, 'Online', d.aviso ? 'Sí' : 'No');
  } finally {
    lock.releaseLock();
  }

  const etiqueta = etiquetaDia_(d.fecha);
  const out = { ok: true, etiqueta: etiqueta, hora: d.hora, nombre: nombre };
  if (cfg.WhatsAppNegocio) {
    out.waNegocio = waLink_(cfg.WhatsAppNegocio,
      'Hola! Reservé un turno para el ' + etiqueta + ' a las ' + d.hora + ' hs a nombre de ' + nombre + '.');
  }
  return out;
}

/* ============ API del dueño ============ */

function apiAdminLogin(clave) {
  const cfg = getConfig_();
  if (!claveOk_(cfg, clave)) return { ok: false };
  return { ok: true, negocio: cfg.Negocio, dias: proximosDias_(cfg), clientes: clientes_() };
}

function apiAdminHorarios(clave, fecha) {
  const cfg = chequear_(clave);
  return libres_(cfg, fecha, leerTurnos_(), 0);
}

function apiAdminGuardar(clave, d) {
  const cfg = chequear_(clave);
  const bloqueo = d.tipo === 'bloqueo';
  const nombre = limpiar_(d.nombre, 60);
  const celular = bloqueo ? '' : limpiar_(d.celular, 20);
  if (!bloqueo && nombre.length < 2) return { ok: false, msg: 'El nombre es muy corto.' };
  if (!bloqueo && celular && !celValido_(celular)) return { ok: false, msg: 'Revisá el celular: solo números, por ejemplo 11 2345 6789.' };
  if (!bloqueo && d.aviso && !celular) return { ok: false, msg: 'Para avisarle por WhatsApp cargá el celular (o destildá el aviso).' };
  if (!d.fecha || !d.hora) return { ok: false, msg: 'Elegí día y horario.' };

  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    if (libres_(cfg, d.fecha, leerTurnos_(), 0).indexOf(d.hora) === -1) {
      return { ok: false, ocupado: true, msg: 'Ese horario se acaba de ocupar.' };
    }
    const aviso = !bloqueo && d.aviso && celValido_(celular) ? 'Sí' : 'No';
    agregarTurno_(d.fecha, d.hora, nombre, celular, bloqueo ? 'Bloqueo' : 'Dueño', aviso);
  } finally {
    lock.releaseLock();
  }
  return { ok: true };
}

// Turnos de clientes (no bloqueos) que ya hay en un día
function apiAdminTurnosDia(clave, fecha) {
  chequear_(clave);
  return turnosClientes_(fecha).map(publico_);
}

// Bloquea el día. Si cancelarTurnos = true, cancela los turnos ya dados y devuelve
// los links de WhatsApp para avisarle a cada cliente.
function apiAdminBloquearDia(clave, fecha, motivo, cancelarTurnos) {
  const cfg = chequear_(clave);
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  let n = 0;
  const afectados = [];
  try {
    if (cancelarTurnos) {
      const sh = hoja_(HOJA_TURNOS);
      turnosClientes_(fecha).forEach(t => {
        sh.getRange(t.fila, COLS.indexOf('Estado') + 1).setValue('Cancelado');
        const p = publico_(t);
        p.wa = avisoCancelacion_(cfg, t, true);
        afectados.push(p);
      });
    }
    const motivoOk = limpiar_(motivo, 60) || 'Día bloqueado';
    const libres = libres_(cfg, fecha, leerTurnos_(), 0);
    agregarTurnos_(libres.map(h => [fecha, h, motivoOk, '', 'Bloqueo', 'No']));
    n = libres.length;
  } finally {
    lock.releaseLock();
  }
  return { ok: true, bloqueados: n, afectados: afectados };
}

function turnosClientes_(fecha) {
  return leerTurnos_()
    .filter(t => t.fecha === fecha && t.estado !== 'Cancelado' && t.origen !== 'Bloqueo')
    .sort((a, b) => a.hora.localeCompare(b.hora));
}

// Link de WhatsApp para avisar que se canceló un turno (o '' si no hay celular válido)
function avisoCancelacion_(cfg, t, diaCerrado) {
  if (!celValido_(t.celular)) return '';
  const primerNombre = t.nombre.split(' ')[0];
  const dia = etiquetaDia_(t.fecha).toLowerCase();
  return waLink_(t.celular, 'Hola ' + primerNombre + ', te escribimos de ' + cfg.Negocio +
    ': tu turno del ' + dia + ' a las ' + t.hora + ' hs quedó cancelado' +
    (diaCerrado ? ' porque ese día no vamos a atender' : '') +
    '. Respondé este mensaje y te damos otro horario. ¡Disculpá las molestias!');
}

function apiAdminAgenda(clave, fecha) {
  chequear_(clave);
  return leerTurnos_()
    .filter(t => t.fecha === fecha && t.estado !== 'Cancelado')
    .sort((a, b) => a.hora.localeCompare(b.hora))
    .map(publico_);
}

function apiAdminCancelar(clave, id) {
  const cfg = chequear_(clave);
  const t = leerTurnos_().find(x => x.id === id);
  if (!t) return { ok: false };
  hoja_(HOJA_TURNOS).getRange(t.fila, COLS.indexOf('Estado') + 1).setValue('Cancelado');
  const out = { ok: true, nombre: t.nombre, hora: t.hora };
  if (t.origen !== 'Bloqueo') out.wa = avisoCancelacion_(cfg, t, false);
  return out;
}

// Turnos del próximo día de atención (mañana, o el lunes si hoy es sábado)
function apiAdminManana(clave) {
  const cfg = chequear_(clave);
  const hoy = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
  const manana = Utilities.formatDate(new Date(Date.now() + 864e5), TZ, 'yyyy-MM-dd');
  const prox = proximosDias_(cfg).find(d => d.fecha > hoy);
  if (!prox) return { etiqueta: '', esManana: false, turnos: [] };
  const esManana = prox.fecha === manana;
  const cuando = esManana ? 'mañana' : 'el ' + prox.etiqueta.toLowerCase();
  const lista = leerTurnos_()
    .filter(t => t.fecha === prox.fecha && t.estado !== 'Cancelado' && t.origen !== 'Bloqueo')
    .sort((a, b) => a.hora.localeCompare(b.hora))
    .map(t => {
      const p = publico_(t);
      if (t.aviso === 'Sí' && celValido_(t.celular)) {
        const primerNombre = t.nombre.split(' ')[0];
        p.wa = waLink_(t.celular, 'Hola ' + primerNombre + ', te recuerdo que ' + cuando + ' tenés turno a las ' +
          t.hora + ' hs en ' + cfg.Negocio + '. Si no podés venir, avisanos por acá. ¡Te esperamos!');
      }
      return p;
    });
  return { etiqueta: prox.etiqueta, esManana: esManana, turnos: lista };
}

function apiAdminMarcarAvisado(clave, id) {
  chequear_(clave);
  const t = leerTurnos_().find(x => x.id === id);
  if (!t) return { ok: false };
  hoja_(HOJA_TURNOS).getRange(t.fila, COLS.indexOf('Avisado') + 1).setValue('Sí');
  return { ok: true };
}

/* ============ Ayudantes ============ */

function getConfig_() {
  const sh = hoja_(HOJA_CONFIG);
  const cfg = {};
  if (sh.getLastRow() < 2) return cfg;
  sh.getRange(2, 1, sh.getLastRow() - 1, 2).getDisplayValues().forEach(r => {
    if (r[0]) cfg[String(r[0]).trim()] = String(r[1]).trim();
  });
  return cfg;
}

function hoja_(nombre) {
  const sh = SpreadsheetApp.getActive().getSheetByName(nombre);
  if (!sh) throw new Error('Falta la hoja "' + nombre + '". Ejecutá setup() primero.');
  return sh;
}

function leerTurnos_() {
  const sh = hoja_(HOJA_TURNOS);
  const n = sh.getLastRow();
  if (n < 2) return [];
  const tzHoja = SpreadsheetApp.getActive().getSpreadsheetTimeZone();
  const rango = sh.getRange(2, 1, n - 1, COLS.length);
  const crudos = rango.getValues();
  const vistos = rango.getDisplayValues();
  return vistos.map((r, i) => ({
    fila: i + 2,
    id: normId_(crudos[i][0], r[0]),
    fecha: normFecha_(crudos[i][1], tzHoja),
    hora: normHora_(crudos[i][2], tzHoja),
    nombre: r[3], celular: r[4], origen: r[5], aviso: r[6], avisado: r[7], estado: r[8],
  }));
}

// Escribe la fila como texto puro: la planilla no puede convertir horas, fechas, IDs ni fórmulas
function agregarTurno_(fecha, hora, nombre, celular, origen, aviso) {
  agregarTurnos_([[fecha, hora, nombre, celular, origen, aviso]]);
}

// Escribe varias filas de una sola vez (mucho más rápido que una por una)
function agregarTurnos_(filas) {
  if (!filas.length) return;
  const sh = hoja_(HOJA_TURNOS);
  const ini = sh.getLastRow() + 1;
  const falta = ini + filas.length - 1 - sh.getMaxRows();
  if (falta > 0) sh.insertRowsAfter(sh.getMaxRows(), falta + 100);
  const creado = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm');
  const valores = filas.map(f => [
    'T' + Utilities.getUuid().replace(/-/g, '').slice(0, 7), f[0], f[1], f[2], f[3], f[4], f[5], 'No', 'Activo', creado,
  ].map(texto_));
  sh.getRange(ini, 1, valores.length, COLS.length).setNumberFormat('@').setValues(valores);
}

function texto_(v) {
  const s = String(v == null ? '' : v);
  return /^=/.test(s) ? "'" + s : s;
}

function normId_(crudo, visto) {
  if (typeof crudo === 'number') return 'N' + crudo.toFixed(0);
  return String(visto || crudo);
}

function normFecha_(v, tzHoja) {
  if (esFecha_(v)) return Utilities.formatDate(v, tzHoja, 'yyyy-MM-dd');
  const s = String(v).trim();
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2);
  return s;
}

function normHora_(v, tzHoja) {
  if (esFecha_(v)) return Utilities.formatDate(v, tzHoja, 'HH:mm');
  if (typeof v === 'number') return aHora_(Math.round(v * 1440) % 1440);
  const s = String(v).trim();
  return /^\d{1,2}:\d{2}/.test(s) ? aHora_(aMin_(s)) : s;
}

function celValido_(c) {
  const s = String(c || '').trim();
  const dig = s.replace(/\D/g, '').length;
  return /^[\d\s()+.\-]+$/.test(s) && dig >= 8 && dig <= 13;
}

function publico_(t) {
  return { id: t.id, hora: t.hora, nombre: t.nombre, celular: t.celular, origen: t.origen,
    aviso: t.aviso, avisado: t.avisado };
}

function horarios_(cfg) {
  const ini = aMin_(cfg.PrimerTurno || '09:00');
  const fin = aMin_(cfg.UltimoTurno || '18:00');
  const paso = Math.max(5, Number(cfg.MinutosPorTurno) || 30);
  const out = [];
  for (let m = ini; m <= fin; m += paso) out.push(aHora_(m));
  return out;
}

function proximosDias_(cfg) {
  const abiertos = String(cfg.DiasDeAtencion || '1,2,3,4,5,6').split(',').map(s => Number(s.trim()));
  const cuantos = Number(cfg.DiasParaAdelante) || 14;
  const out = [];
  for (let i = 0; i <= cuantos; i++) {
    const d = new Date(Date.now() + i * 864e5);
    const dow = Number(Utilities.formatDate(d, TZ, 'u'));
    if (abiertos.indexOf(dow) === -1) continue;
    const fecha = Utilities.formatDate(d, TZ, 'yyyy-MM-dd');
    out.push({ fecha: fecha, etiqueta: NOMBRES_DIA[dow] + ' ' + Utilities.formatDate(d, TZ, 'd/M') });
  }
  return out;
}

function diaValido_(cfg, fecha) {
  return proximosDias_(cfg).some(d => d.fecha === fecha);
}

function libres_(cfg, fecha, turnos, anticipacion) {
  const ocupados = {};
  turnos.forEach(t => { if (t.fecha === fecha && t.estado !== 'Cancelado') ocupados[t.hora] = true; });
  const ahora = new Date();
  const hoy = Utilities.formatDate(ahora, TZ, 'yyyy-MM-dd');
  if (fecha < hoy) return [];
  const limite = aMin_(Utilities.formatDate(ahora, TZ, 'HH:mm')) + anticipacion;
  return horarios_(cfg).filter(h => !ocupados[h] && !(fecha === hoy && aMin_(h) < limite));
}

function etiquetaDia_(fecha) {
  const d = new Date(fecha + 'T12:00:00-03:00');
  return NOMBRES_DIA[Number(Utilities.formatDate(d, TZ, 'u'))] + ' ' + Utilities.formatDate(d, TZ, 'd/M');
}

function clientes_() {
  const map = {};
  leerTurnos_().forEach(t => { if (t.origen !== 'Bloqueo' && t.nombre && t.celular) map[t.nombre] = t.celular; });
  return map;
}

function claveOk_(cfg, clave) {
  return !!cfg.ClaveDueno && String(clave) === String(cfg.ClaveDueno);
}

function chequear_(clave) {
  const cfg = getConfig_();
  if (!claveOk_(cfg, clave)) throw new Error('Clave incorrecta');
  return cfg;
}

function limpiar_(v, max) {
  return String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);
}

function waLink_(cel, texto) {
  let n = String(cel).replace(/\D/g, '');
  if (n.indexOf('549') === 0) { /* ya está bien */ }
  else if (n.indexOf('54') === 0) n = '549' + n.slice(2);
  else { if (n.indexOf('0') === 0) n = n.slice(1); n = '549' + n; }
  return 'https://wa.me/' + n + '?text=' + encodeURIComponent(texto);
}

function aMin_(h) {
  const p = String(h).split(':');
  return Number(p[0]) * 60 + Number(p[1] || 0);
}

function aHora_(m) {
  return ('0' + Math.floor(m / 60)).slice(-2) + ':' + ('0' + (m % 60)).slice(-2);
}

function esFecha_(v) {
  return Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v.getTime());
}
