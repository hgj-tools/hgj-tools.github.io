# -*- coding: utf-8 -*-
"""
הכתבה קולית למחשב - HGJ

כפתור מיקרופון מרחף מעל כל החלונות (או מקש F9). לוחצים, מדברים, שקט קצר מסיים
את המשפט, והטקסט מוקלד ישר לשדה הטקסט הממוקד: Claude, Word, Outlook, דפדפן.

התמלול מקומי לחלוטין (מודל Whisper בעברית של ivrit.ai דרך faster-whisper).
האודיו לא יוצא מהמחשב.

הרצה: הפעלה.bat  |  בדיקה בלי ממשק: python dictate.py --test-wav קובץ.wav
"""
import os
import sys
import json
import time
import queue
import logging
import threading
import ctypes
import hashlib

import numpy as np

APP_VERSION = "1.6.2"
if getattr(sys, "frozen", False):
    HERE = os.path.dirname(sys.executable)          # (אריזת PyInstaller ישנה) config.json ליד קובץ ההרצה
else:
    HERE = os.path.dirname(os.path.abspath(__file__))
# הפייתון המוטמע (._pth) רץ במצב מבודד ולא מוסיף את תיקיית הסקריפט לנתיב החיפוש,
# ולכן import download_model נכשל בהפעלה ראשונה. מוסיפים במפורש.
if HERE not in sys.path:
    sys.path.insert(0, HERE)

# אפליקציה מותקנת (מגרסה 1.1.0): פייתון מוטמע רשמי בתיקיית runtime ליד הסקריפט,
# עם Tcl/Tk שהועתקו מהתקנה מלאה. Tk צריך לדעת איפה הספריות שלו.
_tcl_dir = os.path.join(os.path.dirname(sys.executable), "tcl")
if os.path.isdir(_tcl_dir):
    os.environ.setdefault("TCL_LIBRARY", os.path.join(_tcl_dir, "tcl8.6"))
    os.environ.setdefault("TK_LIBRARY", os.path.join(_tcl_dir, "tk8.6"))
APP_DIR = os.path.join(os.environ.get("LOCALAPPDATA", HERE), "HGJ", "dictation-desktop")
STATE_PATH = os.path.join(APP_DIR, "state.json")
LOG_PATH = os.path.join(APP_DIR, "dictate.log")
CONFIG_PATH = os.path.join(HERE, "config.json")
DICT_PATH = os.path.join(HERE, "dictionary.txt")
DICT_TEMPLATE = """# המילון האישי של הכתבה קולית HGJ
#
# שורה לכל מונח. המנוע יעדיף את המילים שרשומות כאן: שמות לקוחות, חברות,
# אנשים, מונחים מקצועיים ופנימיים שהוא נוטה לשבש.
#
# להחלפה קבועה (כשהמנוע כותב משהו באופן עקבי לא נכון):
#   מה_שהמנוע_כותב => מה_שצריך_להיכתב
#
# שורות שמתחילות ב-# הן הערות. הקובץ נקרא מחדש בכל תמלול, אין צורך להפעיל מחדש.
#
# דוגמאות (מחקו והחליפו בשלכם):
# הוגן גינזבורג יודלביץ
# ביקורת פנימית
# דוח רווח והפסד
# רשות המסים
# מס הכנסה => מס הכנסה
"""

SAMPLE_RATE = 16000
BLOCK = 800                     # 50 אלפיות שנייה לבלוק

COLORS = {
    "loading":      ("#8A94A6", "טוען מודל"),
    "idle":         ("#0F766E", ""),
    "recording":    ("#E03131", "מחכה לדיבור"),
    "speech":       ("#C92A2A", "מקשיב"),
    "transcribing": ("#D97706", "מתמלל"),
    "nospeech":     ("#6B7280", "לא נקלט קול"),
    "error":        ("#6B7280", "שגיאה"),
}

# ----------------------------- Windows -----------------------------
user32 = ctypes.windll.user32
kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
GWL_EXSTYLE = -20
WS_EX_NOACTIVATE = 0x08000000   # לחיצה על הכפתור לא גונבת את המיקוד מהחלון שבו כותבים
WS_EX_TOOLWINDOW = 0x00000080   # לא מופיע ב-Alt+Tab
APP_ID = "HGJ.Dictation"        # זהות בשורת המשימות: בלי זה Windows מציג "Python" (התיאור של pythonw.exe)
ICON_PATH = os.path.join(HERE, "dictate.ico")
# --- עדכונים ---
UPDATE_URL = "https://hgj-tools.github.io/dictation-desktop/version.json"   # קובץ סטטי באתר הכלים, קריאה בלבד
UPDATE_BASE = "https://hgj-tools.github.io/dictation-desktop/"             # קבצי עדכון מורדים רק מכאן
UPDATE_PAGE = "https://hgj-tools.github.io/dictation-desktop/"
RUNTIME_ID_PATH = os.path.join(os.path.dirname(sys.executable), "RUNTIME_ID")
LEGACY_RUNTIME_ID = "4f9bab37"   # ההתקנות 1.1.0 עד 1.2.2 יצאו בלי קובץ RUNTIME_ID, וכולן עם סביבת פייתון זהה
UPDATABLE_FILES = ("dictate.py", "download_model.py")
UPDATE_CHECK_INTERVAL = 24 * 3600
# גליפים מגופן המערכת Segoe MDL2 Assets (קיים ב-Windows 10/11), ללוח הפעולות
MDL2 = {"mic": "\uE720", "file": "\uE8E5", "dict": "\uE82D", "settings": "\uE713", "exit": "\uE7E8", "stop": "\uE71A", "update": "\uE895"}
MDL2["history"] = chr(0xE81C)



# ----------------------------- COM מינימלי (ctypes בלבד) -----------------------------
# משמש רק לעיגון הטקסט במסמך Word פתוח: Selection.Range בתחילת ההאזנה, InsertAfter בסיום התמלול.
# בלי pywin32 ובלי comtypes, כדי שהעדכון יהיה קובץ קוד בלבד ולא ידרוש התקנה מחדש.
from ctypes import wintypes
from ctypes import (POINTER as _PTR, byref as _byref, pointer as _pointer, c_void_p as _vp, c_long as _long,
                    c_ulong as _ulong, c_ushort as _ushort, c_short as _short, c_ubyte as _ubyte, c_uint as _uint,
                    c_longlong as _ll, c_double as _dbl, c_wchar_p as _wstr, HRESULT as _HR)

_ole32 = ctypes.OleDLL("ole32")
_oleaut_h = ctypes.OleDLL("oleaut32")
_oleaut = ctypes.windll.oleaut32
_oleaut.SysAllocString.restype = _vp
_oleaut.SysAllocString.argtypes = [_wstr]
_oleaut.SysFreeString.argtypes = [_vp]
_oleaut.SysStringLen.argtypes = [_vp]


class _GUID(ctypes.Structure):
    _fields_ = [("d1", _ulong), ("d2", _ushort), ("d3", _ushort), ("d4", _ubyte * 8)]


def _guid(s):
    g = _GUID()
    _ole32.CLSIDFromString(_wstr(s), _byref(g))
    return g


_IID_IDISPATCH = _guid("{00020400-0000-0000-C000-000000000046}")
_IID_NULL = _GUID()


class _VARIANT(ctypes.Structure):
    class _U(ctypes.Union):
        _fields_ = [("llVal", _ll), ("lVal", _long), ("iVal", _short), ("dblVal", _dbl), ("ptr", _vp)]
    _anonymous_ = ("u",)
    _fields_ = [("vt", _ushort), ("r1", _ushort), ("r2", _ushort), ("r3", _ushort), ("u", _U), ("pad", _vp)]


class _DISPPARAMS(ctypes.Structure):
    _fields_ = [("rgvarg", _PTR(_VARIANT)), ("named", _PTR(_long)), ("cArgs", _uint), ("cNamed", _uint)]


def _vcall(this, idx, restype, argtypes, *args):
    vtbl = ctypes.cast(this, _PTR(_vp))[0]
    fn = ctypes.cast(vtbl, _PTR(_vp))[idx]
    return ctypes.WINFUNCTYPE(restype, _vp, *argtypes)(fn)(this, *args)


class Disp:
    """עטיפה לאובייקט IDispatch. get = מאפיין, call = שיטה, put = הצבת מאפיין. כל כשל הוא OSError."""

    def __init__(self, p):
        self.p = p

    def __del__(self):
        try:
            if self.p:
                _vcall(self.p, 2, _ulong, ())
                self.p = None
        except Exception:
            pass

    def _invoke(self, name, flags, args):
        n = _wstr(name)
        did = _long()
        _vcall(self.p, 5, _HR, (_PTR(_GUID), _PTR(_wstr), _uint, _ulong, _PTR(_long)),
               _byref(_IID_NULL), _byref(n), 1, 0, _byref(did))
        cnt = len(args)
        arr = (_VARIANT * max(cnt, 1))()
        bstrs = []
        for i, a in enumerate(reversed(args)):
            v = arr[i]
            if isinstance(a, bool):
                v.vt, v.iVal = 11, (-1 if a else 0)
            elif isinstance(a, int):
                v.vt, v.lVal = 3, a
            elif isinstance(a, str):
                b = _oleaut.SysAllocString(a)
                bstrs.append(b)
                v.vt, v.ptr = 8, b
            elif isinstance(a, Disp):
                v.vt, v.ptr = 9, a.p
            elif isinstance(a, _long):                       # פרמטר פלט (ByRef Long)
                v.vt, v.ptr = 0x4003, ctypes.addressof(a)
            else:
                raise TypeError(type(a))
        dp = _DISPPARAMS()
        dp.rgvarg = ctypes.cast(arr, _PTR(_VARIANT)) if cnt else None
        dp.cArgs = cnt
        if flags == 4:
            named = _long(-3)                                # DISPID_PROPERTYPUT
            dp.named, dp.cNamed = _pointer(named), 1
        res = _VARIANT()
        try:
            _vcall(self.p, 6, _HR, (_long, _PTR(_GUID), _ulong, _ushort, _PTR(_DISPPARAMS), _PTR(_VARIANT), _vp, _vp),
                   did, _byref(_IID_NULL), 0, flags, _byref(dp), _byref(res), None, None)
        finally:
            for b in bstrs:
                _oleaut.SysFreeString(b)
        if res.vt == 9:
            return Disp(res.ptr) if res.ptr else None
        if res.vt == 3:
            return res.lVal
        if res.vt == 2:
            return res.iVal
        if res.vt == 11:
            return bool(res.iVal)
        if res.vt == 5:
            return res.dblVal
        if res.vt == 8:
            s = ctypes.wstring_at(res.ptr, _oleaut.SysStringLen(res.ptr)) if res.ptr else ""
            _oleaut.SysFreeString(res.ptr)
            return s
        if res.vt not in (0, 1):
            _oleaut_h.VariantClear(_byref(res))
        return None

    def get(self, name, *args):
        return self._invoke(name, 3, args)

    def call(self, name, *args):
        return self._invoke(name, 1, args)

    def put(self, name, value):
        return self._invoke(name, 4, (value,))


def com_active_object(progid):
    """האובייקט הרץ של progid (למשל Word.Application), או OSError אם אין."""
    try:
        _ole32.CoInitialize(None)
    except OSError:
        pass
    clsid = _GUID()
    _ole32.CLSIDFromProgID(_wstr(progid), _byref(clsid))
    punk = _vp()
    _oleaut_h.GetActiveObject(_byref(clsid), None, _byref(punk))
    pd = _vp()
    try:
        _vcall(punk.value, 0, _HR, (_PTR(_GUID), _PTR(_vp)), _byref(_IID_IDISPATCH), _byref(pd))
    finally:
        _vcall(punk.value, 2, _ulong, ())
    return Disp(pd.value)


class Uia:
    """ממשק הנגישות של Windows (IUIAutomation) דרך ctypes. משמש רק לזכור את הרכיב הממוקד בתחילת ההאזנה
    ולהחזיר אליו את המיקוד לפני ההדבקה. לא נקרא שם הרכיב ולא התוכן שלו: סוג ומחלקה בלבד."""
    _inst = None

    @classmethod
    def get(cls):
        if cls._inst is None:
            try:
                _ole32.CoInitialize(None)
            except OSError:
                pass
            p = _vp()
            _ole32.CoCreateInstance(_byref(_guid("{ff48dba4-60ef-4201-aa87-54103eef594e}")), None, 1,
                                    _byref(_guid("{30cbe57d-d9d0-452a-ab13-7ac5ac4825ee}")), _byref(p))
            cls._inst = cls()
            cls._inst.p = p.value
        return cls._inst

    def focused(self):
        e = _vp()
        _vcall(self.p, 8, _HR, (_PTR(_vp),), _byref(e))                    # GetFocusedElement
        return e.value

    def same(self, a, b):
        r = ctypes.c_int()
        _vcall(self.p, 3, _HR, (_vp, _vp, _PTR(ctypes.c_int)), a, b, _byref(r))   # CompareElements
        return bool(r.value)

    @staticmethod
    def control_type(e):
        v = ctypes.c_int()
        _vcall(e, 21, _HR, (_PTR(ctypes.c_int),), _byref(v))
        return v.value

    @staticmethod
    def class_name(e):
        b = _vp()
        _vcall(e, 30, _HR, (_PTR(_vp),), _byref(b))
        if not b.value:
            return ""
        s = ctypes.wstring_at(b.value, _oleaut.SysStringLen(b.value))
        _oleaut.SysFreeString(b.value)
        return s

    @staticmethod
    def set_focus(e):
        _vcall(e, 3, _HR, ())

    @staticmethod
    def release(e):
        try:
            if e:
                _vcall(e, 2, _ulong, ())
        except Exception:
            pass


class _UiaWorker:
    """תהליכון אחד קבוע שבו נוצרים, משמשים ומשוחררים כל רכיבי ממשק הנגישות. רכיב COM שייך לתהליכון שיצר אותו:
    כשהתהליכון מסתיים הרכיב מתנתק, ושימוש בו מתהליכון אחר נכשל."""

    def __init__(self):
        self.q = queue.Queue()
        threading.Thread(target=self._run, daemon=True).start()

    def _run(self):
        try:
            _ole32.CoInitialize(None)
        except OSError:
            pass
        while True:
            fn, args, done = self.q.get()
            try:
                fn(*args)
            except Exception as e:
                logging.info("uia worker: %s", type(e).__name__)
            done.set()

    def submit(self, fn, *args):
        done = threading.Event()
        self.q.put((fn, args, done))
        return done


_uia_worker_inst = None


def uia_worker():
    global _uia_worker_inst
    if _uia_worker_inst is None:
        _uia_worker_inst = _UiaWorker()
    return _uia_worker_inst


def uia_release_later(el):
    if el:
        uia_worker().submit(Uia.release, el)


class _GUITHREADINFO(ctypes.Structure):
    _fields_ = [("cbSize", wintypes.DWORD), ("flags", wintypes.DWORD), ("hwndActive", wintypes.HWND),
                ("hwndFocus", wintypes.HWND), ("hwndCapture", wintypes.HWND), ("hwndMenuOwner", wintypes.HWND),
                ("hwndMoveSize", wintypes.HWND), ("hwndCaret", wintypes.HWND), ("rcCaret", wintypes.RECT)]


user32.WindowFromPoint.argtypes = [wintypes.POINT]
user32.WindowFromPoint.restype = wintypes.HWND
user32.GetAncestor.argtypes = [wintypes.HWND, wintypes.UINT]
user32.GetAncestor.restype = wintypes.HWND
user32.GetForegroundWindow.restype = wintypes.HWND


def window_class(hwnd):
    if not hwnd:
        return ""
    buf = ctypes.create_unicode_buffer(128)
    user32.GetClassNameW(hwnd, buf, 128)
    return buf.value


def focus_and_caret(hwnd):
    """(חלון המיקוד, (חלון הסמן, x, y במסך)) של התהליכון שמחזיק את hwnd. הסמן None בתוכנות שלא חושפות אותו (Chrome, Electron)."""
    g = _GUITHREADINFO()
    g.cbSize = ctypes.sizeof(_GUITHREADINFO)
    if not hwnd or not user32.GetGUIThreadInfo(user32.GetWindowThreadProcessId(hwnd, None), _byref(g)):
        return None, None
    caret = None
    if g.hwndCaret:
        pt = wintypes.POINT(g.rcCaret.left, g.rcCaret.top)
        user32.ClientToScreen(g.hwndCaret, _byref(pt))
        caret = (g.hwndCaret, pt.x, pt.y)
    return g.hwndFocus, caret


def _clipboard_set_private(text):
    """שם טקסט בלוח עם שלושת הסימונים ש-Windows מכבד: לא לשמור בהיסטוריית הלוח (Win+V), לא להעלות ללוח בענן,
    ולא להעביר לתוכנות שמנטרות את הלוח. הטקסט המוכתב עובר בלוח רק כדי להידבק, ולא אמור להישאר בשום מקום אחר."""
    k32 = ctypes.windll.kernel32
    k32.GlobalAlloc.restype = _vp
    k32.GlobalAlloc.argtypes = [_uint, ctypes.c_size_t]
    k32.GlobalLock.restype = _vp
    k32.GlobalLock.argtypes = [_vp]
    k32.GlobalUnlock.argtypes = [_vp]
    user32.SetClipboardData.restype = _vp
    user32.SetClipboardData.argtypes = [_uint, _vp]
    user32.OpenClipboard.argtypes = [wintypes.HWND]

    def put(fmt, data):
        h = k32.GlobalAlloc(2, len(data))                   # GMEM_MOVEABLE
        p = k32.GlobalLock(h)
        ctypes.memmove(p, data, len(data))
        k32.GlobalUnlock(h)
        if not user32.SetClipboardData(fmt, h):
            raise OSError("SetClipboardData failed")

    for _ in range(12):
        if user32.OpenClipboard(None):
            break
        time.sleep(0.03)
    else:
        raise OSError("clipboard busy")
    try:
        user32.EmptyClipboard()
        put(13, text.encode("utf-16-le") + b"\0\0")       # CF_UNICODETEXT
        for name in ("ExcludeClipboardContentFromMonitorProcessing", "CanIncludeInClipboardHistory",
                     "CanUploadToCloudClipboard"):
            put(user32.RegisterClipboardFormatW(name), b"\0\0\0\0")
    finally:
        user32.CloseClipboard()


def clip_copy(text):
    try:
        _clipboard_set_private(text)
    except Exception as e:
        logging.info("private clipboard not available (%s), using the regular one", type(e).__name__)
        import pyperclip
        pyperclip.copy(text)


def load_config():
    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        cfg = json.load(f)
    cfg["model_dir"] = os.path.expandvars(cfg["model_dir"])
    return cfg


def save_config(cfg):
    """שומר את ההגדרות לקובץ, בלי לדרוס את ההערה ואת model_dir המורחב."""
    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        raw = json.load(f)
    for k, v in cfg.items():
        if k != "model_dir":
            raw[k] = v
    with open(CONFIG_PATH, "w", encoding="utf-8") as f:
        json.dump(raw, f, ensure_ascii=False, indent=2)


def list_input_devices():
    """[(אינדקס, שם)] של מכשירי הקלט, בלי כפילויות של אותו שם בין ממשקי השמע השונים."""
    import sounddevice as sd
    out, seen = [], set()
    for i, d in enumerate(sd.query_devices()):
        if d["max_input_channels"] > 0:
            name = d["name"].strip()
            if name not in seen:
                seen.add(name)
                out.append((i, name))
    return out


def load_state():
    try:
        with open(STATE_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def ensure_dictionary():
    if not os.path.exists(DICT_PATH):
        try:
            with open(DICT_PATH, "w", encoding="utf-8") as f:
                f.write(DICT_TEMPLATE)
        except Exception:
            pass


def load_dictionary():
    """מילון אישי: מונחים שהמנוע יעדיף (hotwords) והחלפות קבועות (מה => למה)."""
    hot, repl = [], []
    try:
        with open(DICT_PATH, "r", encoding="utf-8") as f:
            for line in f:
                s = line.strip()
                if not s or s.startswith("#"):
                    continue
                if "=>" in s:
                    a, b = [x.strip() for x in s.split("=>", 1)]
                    if a and a != b:
                        repl.append((a, b))
                else:
                    hot.append(s)
    except FileNotFoundError:
        pass
    repl.sort(key=lambda p: -len(p[0]))     # החלפות ארוכות קודם, כדי שלא יישברו על ידי קצרות
    return hot, repl


def window_title(hwnd):
    if not hwnd:
        return "(none)"
    buf = ctypes.create_unicode_buffer(256)
    user32.GetWindowTextW(hwnd, buf, 256)
    return buf.value or f"hwnd {hwnd}"


def save_state(st):
    try:
        os.makedirs(APP_DIR, exist_ok=True)
        with open(STATE_PATH, "w", encoding="utf-8") as f:
            json.dump(st, f, ensure_ascii=False)
    except Exception:
        pass


def _scrub_old_log():
    """גרסאות עד 1.3.0 רשמו ביומן את כותרת חלון היעד ואת נתיב קובץ התמלול, שיכולים לכלול שם מסמך או לקוח.
    מוחק את השורות האלה מהיומן הקיים. רץ בכל הפעלה, ועושה משהו רק אם נשארו שורות כאלה."""
    try:
        if not os.path.exists(LOG_PATH) or os.path.getsize(LOG_PATH) > 30 * 1024 * 1024:
            return
        with open(LOG_PATH, "r", encoding="utf-8", errors="replace") as f:
            lines = f.readlines()
        keep = [l for l in lines if "target window:" not in l and not ("file transcribed" in l and " -> " in l)]
        if len(keep) != len(lines):
            tmp = LOG_PATH + ".tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                f.writelines(keep)
            os.replace(tmp, LOG_PATH)
    except Exception:
        pass


def setup_logging():
    os.makedirs(APP_DIR, exist_ok=True)
    _scrub_old_log()
    logging.basicConfig(filename=LOG_PATH, level=logging.INFO, encoding="utf-8",
                        format="%(asctime)s %(levelname)s %(message)s")
    try:
        # pythonw רץ בלי stderr: קריסה של קוד מקורי (COM, ספריות) נעלמת בלי עקבות. כאן היא נרשמת.
        import faulthandler
        global _crash_file
        _crash_file = open(os.path.join(APP_DIR, "crash.log"), "a", encoding="utf-8")
        _crash_file.write(time.strftime("--- %Y-%m-%d %H:%M:%S start ") + APP_VERSION + chr(10))
        _crash_file.flush()
        faulthandler.enable(file=_crash_file)
    except Exception:
        pass


# ----------------------------- הקלטה וזיהוי שקט -----------------------------
def version_tuple(v):
    out = []
    for part in str(v).split("."):
        digits = "".join(ch for ch in part if ch.isdigit())
        out.append(int(digits) if digits else 0)
    return tuple(out)


def installed_runtime_id():
    try:
        with open(RUNTIME_ID_PATH, "r", encoding="utf-8") as f:
            return f.read().strip()
    except Exception:
        return LEGACY_RUNTIME_ID


def sha256_file(path):
    hsh = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            hsh.update(chunk)
    return hsh.hexdigest()


def fetch_update_info(timeout=8):
    """קורא את version.json מהאתר. קריאת HTTPS אחת, בלי לשלוח שום דבר מלבד הבקשה עצמה."""
    import urllib.request, ssl
    req = urllib.request.Request(UPDATE_URL + "?t=" + str(int(time.time())),
                                 headers={"User-Agent": f"HGJ-Dictation/{APP_VERSION}", "Cache-Control": "no-cache"})
    with urllib.request.urlopen(req, timeout=timeout, context=ssl.create_default_context()) as r:
        info = json.loads(r.read().decode("utf-8"))
    if not isinstance(info, dict) or "version" not in info:
        raise ValueError("version.json לא תקין")
    return info


def evaluate_update(info):
    """מחזיר (יש_עדכון, נדרשת_התקנה_מלאה)."""
    newer = version_tuple(info["version"]) > version_tuple(APP_VERSION)
    full = bool(info.get("runtime_id")) and info["runtime_id"] != installed_runtime_id()
    return newer, full


def download_verified(url, dest, sha256_expected, timeout=30):
    import urllib.request, ssl
    req = urllib.request.Request(url + "?v=" + str(int(time.time())), headers={"User-Agent": f"HGJ-Dictation/{APP_VERSION}"})
    with urllib.request.urlopen(req, timeout=timeout, context=ssl.create_default_context()) as r:
        data = r.read()
    got = hashlib.sha256(data).hexdigest()
    if got.lower() != str(sha256_expected).lower():
        raise ValueError(f"חתימת הקובץ {os.path.basename(dest)} לא תואמת (התקבל {got[:12]}, צפוי {str(sha256_expected)[:12]})")
    with open(dest, "wb") as f:
        f.write(data)
    return dest


def apply_code_update(info, progress=None):
    """מוריד את קבצי הקוד החדשים לתיקיית updates, מאמת חתימה וקומפילציה, ומחליף אטומית עם גיבוי .bak.
    מחזיר רשימת הקבצים שהוחלפו. שום קובץ EXE לא מורד ולא מורץ."""
    import py_compile
    files = [f for f in info.get("files", []) if f.get("name") in UPDATABLE_FILES]
    if not files:
        raise ValueError("version.json לא מפרט קבצי קוד")
    upd_dir = os.path.join(HERE, "updates")
    os.makedirs(upd_dir, exist_ok=True)
    for f in files:
        if not str(f.get("url", "")).startswith(UPDATE_BASE):
            raise ValueError("כתובת קובץ העדכון אינה בדף הכלי, העדכון בוטל")
    staged = []
    for i, f in enumerate(files):
        if progress:
            progress(int(10 + 60 * i / len(files)), f"מוריד {f['name']}")
        dest = os.path.join(upd_dir, f["name"] + ".new")
        download_verified(f["url"], dest, f["sha256"])
        if f["name"].endswith(".py"):
            py_compile.compile(dest, cfile=os.path.join(upd_dir, f["name"] + ".pyc"), doraise=True)
        staged.append((f["name"], dest))
    if progress:
        progress(80, "מחליף קבצים")
    replaced = []
    for name, dest in staged:
        target = os.path.join(HERE, name)
        bak = target + ".bak"
        if os.path.exists(target):
            if os.path.exists(bak):
                os.remove(bak)
            os.replace(target, bak)
        os.replace(dest, target)
        replaced.append(name)
    return replaced


def rollback_code_update(names):
    for name in names:
        target = os.path.join(HERE, name)
        bak = target + ".bak"
        if os.path.exists(bak):
            if os.path.exists(target):
                os.remove(target)
            os.replace(bak, target)


class Recorder:
    """מקליט מהמיקרופון ומסיים לבד אחרי שקט. הלוגיקה בת'רד נפרד, לא בקולבק של האודיו."""

    def __init__(self, cfg, on_segment, on_end, on_state, on_level=None):
        self.cfg = cfg
        self.on_segment = on_segment    # מקטע דיבור שהסתיים בשקט קצר: לתמלול, ההאזנה ממשיכה
        self.on_end = on_end            # ההאזנה הסתיימה (לחיצה, שקט ארוך או תקרת זמן)
        self.on_state = on_state
        self.on_level = on_level        # עוצמת קול רגעית, לחיווי הפסים בחלונית
        self.q = queue.Queue()
        self.running = False
        self.cancel = False
        self.stream = None

    @staticmethod
    def resolve_device(cfg):
        """input_device בהגדרות: null = ברירת המחדל של Windows, מספר = אינדקס, טקסט = חלק משם המכשיר."""
        import sounddevice as sd
        want = cfg.get("input_device")
        if want is None or want == "":
            return None
        if isinstance(want, int):
            return want
        for i, d in enumerate(sd.query_devices()):
            if d["max_input_channels"] > 0 and str(want).lower() in d["name"].lower():
                return i
        logging.warning("input_device %r not found, using default", want)
        return None

    def start(self):
        import sounddevice as sd
        if self.running:
            return
        self.running = True
        self.cancel = False
        self.q = queue.Queue()
        self.stream = sd.InputStream(samplerate=SAMPLE_RATE, channels=1, dtype="float32",
                                     blocksize=BLOCK, callback=self._callback,
                                     device=self.resolve_device(self.cfg))
        self.stream.start()
        threading.Thread(target=self._worker, daemon=True).start()

    def stop(self, cancel=False):
        if self.running:
            self.cancel = cancel
            self.running = False

    def _callback(self, indata, frames, t, status):
        if self.running:
            self.q.put(indata[:, 0].copy())

    def _worker(self):
        """מאזין ברצף. שקט קצר סוגר מקטע ושולח אותו לתמלול בלי לעצור את ההאזנה;
        שקט ארוך, לחיצה או תקרת הזמן מסיימים את ההאזנה."""
        cfg = self.cfg
        seg_gap = cfg.get("segment_silence_seconds", cfg.get("silence_seconds", 1.2))
        end_gap = cfg.get("end_silence_seconds", 15)
        preroll_blocks = int(0.5 * SAMPLE_RATE / BLOCK)
        noise = []
        seg_frames = []
        seg_started = False
        any_speech = False
        last_voice = None
        session_last_voice = None
        t0 = time.time()
        peak = 0.0
        threshold = cfg["min_energy_threshold"]
        loud_streak = 0
        segments_sent = 0

        def flush():
            nonlocal seg_frames, seg_started, segments_sent
            if seg_started and seg_frames:
                audio = np.concatenate(seg_frames).astype(np.float32)
                if len(audio) >= 0.4 * SAMPLE_RATE:
                    segments_sent += 1
                    self.on_segment(audio)
            seg_frames = []
            seg_started = False

        while self.running:
            try:
                block = self.q.get(timeout=0.1)
            except queue.Empty:
                continue
            now = time.time()
            # רבע השנייה הראשונה מכילה טרנזיינט של פתיחת המכשיר (נמדד: פי 70 מרצפת הרעש).
            # לא לכיול ולא לזיהוי.
            if now - t0 < 0.25:
                continue
            seg_frames.append(block)
            rms = float(np.sqrt(np.mean(block * block)))
            peak = max(peak, rms)
            noise.append(rms)
            if self.on_level and len(noise) % 2 == 0:      # 10 עדכונים בשנייה מספיקים לפסים
                self.on_level(rms)
            if len(noise) < 4:
                continue
            # רצפת הרעש = האחוזון ה-20 של כל מה שנקלט עד כה. גם בזמן דיבור רציף יש
            # הפסקות בין מילים, ולכן הערך נשאר נמוך. תקרה מונעת סף בלתי אפשרי.
            floor = float(np.percentile(noise, 20))
            threshold = min(max(cfg["min_energy_threshold"], floor * cfg["noise_multiplier"]),
                            cfg.get("max_energy_threshold", 0.04))
            if rms > threshold:
                loud_streak += 1
                if loud_streak >= 2:                 # 100 אלפיות שנייה רצופות, לא קליק
                    if not seg_started:
                        self.on_state("speech")
                    seg_started = True
                    any_speech = True
                    last_voice = now
                    session_last_voice = now
            else:
                loud_streak = 0
                if seg_started and now - last_voice > seg_gap:
                    flush()                          # המשפט הסתיים: לתמלול, וממשיכים להקשיב
                    self.on_state("recording")
                elif not seg_started and len(seg_frames) > 4 * preroll_blocks:
                    seg_frames = seg_frames[-preroll_blocks:]   # לא לצבור שקט, לשמור חצי שנייה לפני הדיבור
            if any_speech and now - session_last_voice > end_gap:
                break
            if not any_speech and now - t0 > cfg["no_speech_timeout_seconds"]:
                self.cancel = True
                break
            if now - t0 > cfg["max_recording_seconds"]:
                break
        self.running = False
        try:
            self.stream.stop()
            self.stream.close()
        except Exception:
            pass
        while not self.q.empty():
            seg_frames.append(self.q.get_nowait())
        flush()
        logging.info("session ended: speech=%s segments=%d peak_rms=%.5f threshold=%.5f noise_floor=%.5f seconds=%.1f",
                     any_speech, segments_sent, peak, threshold,
                     float(np.percentile(noise, 20)) if noise else -1, time.time() - t0)
        self.on_end(any_speech)


# ----------------------------- תמלול -----------------------------
FAST_DIR = os.path.join(APP_DIR, "trial-fast")     # המודל המהיר והמנוע שלו, אם הותקנו (ניסוי, לא חלק מההפצה)


def fast_available():
    return (os.path.exists(os.path.join(FAST_DIR, "model", "encoder.int8.onnx"))
            and os.path.isdir(os.path.join(FAST_DIR, "site", "sherpa_onnx")))


class Transcriber:
    def __init__(self, cfg):
        self.cfg = cfg
        self.model = None
        self.fast = None

    def _load_fast(self):
        """zipformer2 streaming של ivrit.ai דרך sherpa-onnx. נטען לפני Whisper: לשתי הספריות יש onnxruntime.dll משלהן,
        והסדר הזה הוא שנבדק ועובד (הראשונה שנטענת משמשת את שתיהן)."""
        site = os.path.join(FAST_DIR, "site")
        if site not in sys.path:
            sys.path.append(site)
        import sherpa_onnx
        m = os.path.join(FAST_DIR, "model")
        self.fast = sherpa_onnx.OnlineRecognizer.from_transducer(
            tokens=os.path.join(m, "tokens.txt"), encoder=os.path.join(m, "encoder.int8.onnx"),
            decoder=os.path.join(m, "decoder.int8.onnx"), joiner=os.path.join(m, "joiner.int8.onnx"),
            num_threads=4, sample_rate=SAMPLE_RATE, feature_dim=80, decoding_method="greedy_search", provider="cpu")

    def _transcribe_fast(self, audio):
        s = self.fast.create_stream()
        s.accept_waveform(SAMPLE_RATE, np.ascontiguousarray(audio, dtype=np.float32))
        s.accept_waveform(SAMPLE_RATE, np.zeros(int(0.8 * SAMPLE_RATE), dtype=np.float32))
        s.input_finished()
        while self.fast.is_ready(s):
            self.fast.decode_stream(s)
        r = self.fast.get_result(s)
        return (r if isinstance(r, str) else getattr(r, "text", "")).strip()

    def load(self):
        if self.cfg.get("fast_model") and fast_available():
            try:
                self._load_fast()
                logging.info("fast model loaded")
            except Exception as e:
                logging.error("fast model not loaded: %s: %s", type(e).__name__, e)
                self.fast = None
        from faster_whisper import WhisperModel
        if not os.path.exists(os.path.join(self.cfg["model_dir"], "model.bin")):
            raise FileNotFoundError("המודל לא נמצא. הרץ את התקנה.bat פעם אחת.\n" + self.cfg["model_dir"])
        threads = self.cfg.get("cpu_threads") or max(1, (os.cpu_count() or 4) // 2)
        self.model = WhisperModel(self.cfg["model_dir"], device="cpu",
                                  compute_type=self.cfg.get("compute_type", "int8"),
                                  cpu_threads=threads)

    def transcribe(self, audio):
        hot, repl = load_dictionary()
        if self.cfg.get("engine") == "fast" and self.fast is not None:
            try:
                text = " ".join(self._transcribe_fast(audio).split())
                for wrong, right in repl:
                    text = text.replace(wrong, right)
                return text
            except Exception:
                logging.exception("fast model failed, using the accurate model")
        segments, _info = self.model.transcribe(
            audio,
            language=self.cfg.get("language", "he"),
            beam_size=self.cfg.get("beam_size", 1),
            vad_filter=True,
            # מקטע ארוך מעובד בכמה חלונות של 30 שניות. בלי חותמות זמן משפט שחוצה גבול חלון נופל והפיסוק נחלש,
            # לכן במקטע ארוך מפעילים אותן. במקטע קצר (חלון אחד) אין בהן צורך.
            without_timestamps=len(audio) <= 25 * SAMPLE_RATE,
            condition_on_previous_text=False,
            initial_prompt=self.cfg.get("initial_prompt") or None,
            hotwords=" ".join(hot) if hot else None,     # המילון האישי: המנוע מוטה למילים האלה
        )
        text = " ".join(s.text.strip() for s in segments)
        text = " ".join(text.split())
        for wrong, right in repl:                        # החלפות קבועות מהמילון
            text = text.replace(wrong, right)
        return text

    def transcribe_file(self, path, progress=None, on_line=None, cancel=None):
        """תמלול קובץ הקלטה שלם (פגישה, שיחה). מחזיר (שורות, אורך, הופסק).
        on_line(lines, total) נקרא אחרי כל מקטע (לכתיבת תמלול חלקי), cancel() מחזיר True כדי לעצור."""
        hot, repl = load_dictionary()
        segments, info = self.model.transcribe(
            path,
            language=self.cfg.get("language", "he"),
            beam_size=self.cfg.get("file_beam_size", 3),
            vad_filter=True,
            condition_on_previous_text=False,
            initial_prompt=self.cfg.get("initial_prompt") or None,
            hotwords=" ".join(hot) if hot else None,
        )
        total = float(info.duration or 0)
        lines = []
        for s in segments:
            text = " ".join(s.text.split())
            for wrong, right in repl:
                text = text.replace(wrong, right)
            if text:
                lines.append((float(s.start), text))
            if progress and total:
                progress(min(99, int(s.end * 100 / total)))
            if on_line:
                on_line(lines, total)
            if cancel and cancel():
                return lines, total, True
        return lines, total, False


def fmt_ts(sec):
    sec = int(sec)
    return f"{sec // 3600:02d}:{(sec % 3600) // 60:02d}:{sec % 60:02d}"


def transcript_path(src_path):
    return os.path.splitext(src_path)[0] + " - תמלול.txt"


def write_transcript(src_path, lines, total, status=""):
    """כותב קובץ טקסט (UTF-8) לצד ההקלטה, עם חותמות זמן, ומחזיר את הנתיב.
    נקרא גם באמצע התמלול, כך שהקובץ תמיד מכיל את מה שתומלל עד עכשיו."""
    out = transcript_path(src_path)
    header = [
        f"תמלול הקלטה: {os.path.basename(src_path)}" + (f"   [{status}]" if status else ""),
        f"נוצר: {time.strftime('%d.%m.%Y %H:%M')} · אורך: {fmt_ts(total)} · "
        f"מנוע: ivrit-ai/whisper-large-v3-turbo, מקומי · הכתבה קולית HGJ {APP_VERSION}",
        "הערה: תמלול אוטומטי. יש לאמת ציטוטים מול ההקלטה לפני שימוש.",
        "",
    ]
    tmp = out + ".tmp"
    with open(tmp, "w", encoding="utf-8-sig") as f:      # BOM: Notepad ו-Word מזהים UTF-8 בלי לשאול
        f.write("\n".join(header))
        for start, text in lines:
            f.write(f"[{fmt_ts(start)}] {text}\n")
    os.replace(tmp, out)
    return out


# ----------------------------- הקלדה לשדה הממוקד -----------------------------
class Typer:
    """מכניס את הטקסט למקום שבו עמד הסמן כשההאזנה התחילה.
    שלוש דרכים, לפי מה שהתוכנה מאפשרת:
    1. Word, כשהסמן בגוף המסמך: עיגון לטווח (Range) דרך COM. הטקסט נכנס למקום המקורי גם אם המשתמש
       המשיך לעבוד במקום אחר במסמך או בחלון אחר, בלי לוח ובלי להחליף חלון.
    2. כל השאר: הדבקה דרך הלוח ו-Ctrl+V, כמו תמיד, כל עוד הסמן לא הוזז.
    3. הסמן הוזז (לחיצה בחלון היעד שהזיזה את הסמן, או מעבר לשדה אחר): לא מדביקים בעיוורון. הטקסט נשמר בלוח
       ומוצגת הודעה, והמשתמש מדביק בעצמו במקום הנכון."""

    def __init__(self, cfg):
        self.cfg = cfg
        self.my_hwnd = None
        self.last_fg = None
        self.target = None       # החלון שבו עמד הסמן כשההאזנה התחילה
        self.session_id = 0
        self.word = None         # עוגן Word: {"app", "rng", "story", "first"}
        self.hold = False        # הסמן זז: מכאן ועד סוף ההאזנה הטקסט נצבר בלוח
        self.held_text = ""
        self.clicked = False     # לחיצת עכבר בחלון היעד מאז ההדבקה האחרונה
        self.base_focus = None
        self.base_caret = None
        self.uia_el = None       # תיבת ההערה שהחזיקה את המקלדת בתחילת ההאזנה, להחזרת המיקוד
        self.comment_scan = None # תוצאת הסריקה: True = תיבת הערה ממוקדת, False = אין, None = לא ידוע עדיין

    def track(self):
        fg = user32.GetForegroundWindow()
        if fg and fg != self.my_hwnd:
            self.last_fg = fg

    # --- תחילת האזנה וסיומה ---
    def lock_target(self):
        """נקרא בתחילת ההאזנה: זוכר את החלון, את שדה המיקוד ואת מיקום הסמן."""
        fg = user32.GetForegroundWindow()
        self.target = fg if (fg and fg != self.my_hwnd) else self.last_fg
        self.session_id += 1
        self.word = None
        self.hold = False
        self.held_text = ""
        self.clicked = False
        self.base_focus, self.base_caret = focus_and_caret(self.target)
        cls = window_class(self.target)
        uia_release_later(self.uia_el)
        self.uia_el = None
        self.comment_scan = None
        if cls == "OpusApp":
            # עיגון לגוף המסמך והחזרת מיקוד להערה כבויים כברירת מחדל: הם תלויים בסריקת עץ הנגישות של Word,
            # שעדיין לא הוכחה מספיק בשימוש אמיתי. עיגון להערה פעיל: שם Word מדווח במפורש שהבחירה בתוך הערה.
            body = self.cfg.get("word_body_anchor", False)
            if body or self.cfg.get("uia_refocus", False):
                uia_worker().submit(self._scan_comment_editor, self.session_id)
            if self.cfg.get("word_direct_insert", True) and (body or self.cfg.get("word_comment_anchor", True)):
                self._word_capture()
        # היומן רושם את סוג החלון בלבד, לא את הכותרת שלו (כותרת יכולה להיות שם של מסמך)
        logging.info("target: class=%s word_anchor=%s caret=%s", cls, bool(self.word), bool(self.base_caret))
        if self.cfg.get("safe_paste", True):
            threading.Thread(target=self._watch_clicks, args=(self.session_id,), daemon=True).start()

    def end_session(self):
        self.session_id += 1     # עוצר את מעקב הלחיצות
        self.word = None
        uia_release_later(self.uia_el)
        self.uia_el = None

    # --- כרטיסי הערות ב-Word (ובכל מקום ב-Word שאינו גוף המסמך) ---
    def _uia_capture(self):
        """מחזיר True אם המיקוד בגוף המסמך, False אם ברכיב אחר (כרטיס הערה וכדומה), None אם לא ידוע.
        רכיב אחר נזכר, כדי להחזיר אליו את המיקוד לפני ההדבקה."""
        try:
            if user32.IsHungAppWindow(self.target):
                return None
            uia = Uia.get()
            e = uia.focused()
            if not e:
                return None
            ct, cn = uia.control_type(e), uia.class_name(e)
            in_body = (ct == 50030 and cn == "_WwG")           # 50030 = Document, _WwG = משטח העריכה של המסמך
            logging.info("uia focus: ctype=%d class=%s body=%s", ct, cn[:24], in_body)
            if not in_body and self.cfg.get("uia_refocus", True):
                self.uia_el = e
            else:
                uia.release(e)
            return in_body
        except Exception as ex:
            logging.info("uia capture not available: %s", type(ex).__name__)
            return None

    def _scan_comment_editor(self, sid):
        """רץ ברקע בתחילת האזנה ב-Word. מחפש בעץ הנגישות תיבת הערה (cardEditor_ / postEditor_) שמחזיקה את
        מיקוד המקלדת. נקראים סוג הרכיב, המזהה שלו ודגל המיקוד בלבד, לא שם ולא תוכן."""
        t0 = time.time()
        found, kind, editors, scan_ok = None, "none", 0, False
        try:
            try:
                _ole32.CoInitialize(None)
            except OSError:
                pass
            p = _vp()
            _ole32.CoCreateInstance(_byref(_guid("{ff48dba4-60ef-4201-aa87-54103eef594e}")), None, 1,
                                    _byref(_guid("{30cbe57d-d9d0-452a-ab13-7ac5ac4825ee}")), _byref(p))
            root, cond, arr = _vp(), _vp(), _vp()
            _vcall(p.value, 6, _HR, (wintypes.HWND, _PTR(_vp)), self.target, _byref(root))       # ElementFromHandle
            _vcall(p.value, 21, _HR, (_PTR(_vp),), _byref(cond))                                 # CreateTrueCondition
            _vcall(root.value, 6, _HR, (ctypes.c_int, _vp, _PTR(_vp)), 4, cond.value, _byref(arr))   # FindAll, צאצאים
            n = ctypes.c_int()
            _vcall(arr.value, 3, _HR, (_PTR(ctypes.c_int),), _byref(n))
            for i in range(n.value):
                e = _vp()
                _vcall(arr.value, 4, _HR, (ctypes.c_int, _PTR(_vp)), i, _byref(e))
                keep = False
                try:
                    if Uia.control_type(e.value) == 50004:                       # Edit
                        b = _vp()
                        _vcall(e.value, 29, _HR, (_PTR(_vp),), _byref(b))         # AutomationId
                        aid = ""
                        if b.value:
                            aid = ctypes.wstring_at(b.value, _oleaut.SysStringLen(b.value))
                            _oleaut.SysFreeString(b.value)
                        if aid.startswith(("cardEditor_", "postEditor_")):
                            editors += 1
                            kb = ctypes.c_int()
                            _vcall(e.value, 26, _HR, (_PTR(ctypes.c_int),), _byref(kb))   # HasKeyboardFocus
                            if kb.value and found is None:
                                found, kind, keep = e.value, aid.split("_")[0], True
                except OSError:
                    pass
                if not keep:
                    Uia.release(e.value)
            for x in (arr.value, cond.value, root.value, p.value):
                Uia.release(x)
            scan_ok = True
        except Exception as ex:
            logging.info("uia scan failed: %s", type(ex).__name__)
        logging.info("uia comment editors: %d, with keyboard focus: %s (%.1fs)", editors, kind, time.time() - t0)
        if self.session_id == sid:
            self.uia_el = found
            self.comment_scan = bool(found) if scan_ok else None
        elif found:
            Uia.release(found)       # כבר בתהליכון הנגישות

    def _uia_refocus(self):
        """מחזיר את המיקוד לתיבת ההערה שנזכרה, ומאמת שהמיקוד באמת חזר אליה לפני שמדביקים. רץ בתהליכון הנגישות."""
        if not self.uia_el or not self.cfg.get("uia_refocus", False):
            return False
        box = {}
        done = uia_worker().submit(lambda: box.__setitem__("ok", self._uia_refocus_impl()))
        done.wait(2.5)
        return bool(box.get("ok"))

    def _uia_refocus_impl(self):
        if not self.uia_el:
            return False
        try:
            Uia.set_focus(self.uia_el)
            time.sleep(0.25)
            kb = ctypes.c_int()
            _vcall(self.uia_el, 26, _HR, (_PTR(ctypes.c_int),), _byref(kb))       # HasKeyboardFocus
            ok = bool(kb.value)
            logging.info("uia refocus to comment editor: %s", "ok" if ok else "focus did not return")
            return ok
        except Exception as ex:
            logging.info("uia refocus failed: %s", type(ex).__name__)
            return False

    def _watch_clicks(self, sid):
        """דוגם את כפתור העכבר השמאלי כל 8 אלפיות שנייה, רק בזמן האזנה ותמלול. לחיצה בתוך חלון היעד נרשמת.
        לא נרשם מיקום ולא נשמר דבר: דגל בוליאני בלבד."""
        # קריאה ראשונה נזרקת: הביט "נלחץ מאז הקריאה הקודמת" זוכר את הלחיצה שהציבה את הסמן לפני ההאזנה
        down = bool(user32.GetAsyncKeyState(0x01) & 0x8000)
        while self.session_id == sid:
            st = user32.GetAsyncKeyState(0x01)
            now = bool(st & 0x8001)
            if now and not down:
                pt = wintypes.POINT()
                user32.GetCursorPos(_byref(pt))
                h = user32.WindowFromPoint(pt)
                if h and user32.GetAncestor(h, 2) == self.target:
                    self.clicked = True
            down = bool(st & 0x8000)
            time.sleep(0.008)

    # --- Word ---
    def _word_capture(self):
        """מעגן לטווח הבחירה ב-Word, רק אם ודאי שהסמן נמצא בגוף המסמך: הסמן המערכתי חייב להימצא במקום
        ש-Word מדווח עליו. בכרטיס הערה (ובכל מקום אחר שאינו גוף המסמך) Selection לא משקף את מקום ההקלדה,
        ואז לא מעגנים וההדבקה הרגילה חלה."""
        try:
            if user32.IsHungAppWindow(self.target) or not self.base_caret:
                return
            app = com_active_object("Word.Application")
            win = app.get("ActiveWindow")
            if (win.get("Hwnd") & 0xFFFFFFFF) != (self.target & 0xFFFFFFFF):
                return
            sel = app.get("Selection")
            rng = sel.get("Range")
            story = rng.get("StoryType")
            collapsed = rng.get("Start") == rng.get("End")
            if not collapsed:
                # טקסט מסומן: עיגון היה מחליף אותו. לא מעגנים, וההדבקה הרגילה (עם זיהוי תזוזה) חלה.
                logging.info("word selection: story=%d not collapsed, no anchor", story)
                return
            if story == 4 and not self.cfg.get("word_comment_anchor", True):
                logging.info("word selection: story=4 comment anchor disabled in settings")
                return
            if story == 4 and sel.get("Information", 26):
                # הערה: Word מדווח במפורש שהבחירה בתוך הערה. מעגנים לטווח שבתוך ההערה.
                ok = True
            elif not self.cfg.get("word_body_anchor", False):
                logging.info("word selection: story=%d body anchor disabled in settings", story)
                return
            else:
                l, t, w, h = _long(), _long(), _long(), _long()
                win.call("GetPoint", l, t, w, h, rng)
                _hc, cx, cy = self.base_caret
                tol = int(40 * max(1.0, user32.GetDpiForWindow(self.target) / 96.0))
                ok = (l.value - tol <= cx <= l.value + w.value + tol) and (t.value - h.value <= cy <= t.value + 2 * h.value)
            logging.info("word selection: story=%d anchored=%s", story, ok)
            if ok:
                self.word = {"app": app, "rng": rng, "story": story,
                             "first": rng.get("Start") != rng.get("End")}
        except Exception as e:
            logging.info("word anchor not available: %s", type(e).__name__)
            self.word = None

    def _word_insert(self, text):
        """מכניס את הטקסט בעוגן. אם הסמן של המשתמש עדיין עומד שם, מזיז אותו לסוף הטקסט שהוכנס, כמו בהקלדה.
        אם המשתמש עבר למקום אחר, הסמן שלו לא זז."""
        w = self.word
        app, rng = w["app"], w["rng"]
        if user32.IsHungAppWindow(self.target):
            raise OSError("word not responding")
        follow = False
        try:
            if (app.get("ActiveWindow").get("Hwnd") & 0xFFFFFFFF) == (self.target & 0xFFFFFFFF):
                sel = app.get("Selection")
                s0, s1 = sel.get("Start"), sel.get("End")
                r0, r1 = rng.get("Start"), rng.get("End")
                same_story = sel.get("StoryType") == w["story"]
                follow = same_story and ((w["first"] and s0 == r0 and s1 == r1) or (s0 == s1 == r1))
        except OSError:
            follow = False
        if w["first"]:
            rng.put("Text", text)        # הבחירה המקורית מוחלפת, כמו בהדבקה על טקסט מסומן
            w["first"] = False
        else:
            rng.call("InsertAfter", text)
        if follow:
            e = rng.get("End")
            app.get("Selection").call("SetRange", e, e)

    # --- הדבקה ---
    def _moved(self):
        if not self.cfg.get("safe_paste", True):
            return False
        focus, caret = focus_and_caret(self.target)
        if self.base_focus and focus and focus != self.base_focus:
            return True
        if self.clicked:
            if self.base_caret and caret:
                return (caret[0] != self.base_caret[0] or abs(caret[1] - self.base_caret[1]) > 2
                        or abs(caret[2] - self.base_caret[2]) > 2)
            return True          # תוכנה שלא חושפת סמן: לחיצה בחלון היעד נחשבת תזוזה
        return False

    def _hold(self, text):
        import pyperclip
        self.hold = True
        self.held_text += text
        clip_copy(self.held_text)
        logging.info("caret moved: %d chars kept on clipboard, not pasted", len(self.held_text))
        return "held"

    def type_text(self, text):
        """מחזיר "word" (עוגן), "pasted" (הדבקה רגילה) או "held" (הסמן זז, הטקסט בלוח)."""
        import keyboard
        import pyperclip
        if self.cfg.get("append_space", True):
            text += " "
        if self.hold:
            return self._hold(text)
        if self.word and self.word["story"] != 4 and self.comment_scan is not False:
            # עוגן לגוף המסמך תקף רק אם הסריקה אישרה שאין תיבת הערה שמחזיקה את המקלדת. כשפותחים הערה חדשה,
            # Word עדיין מדווח בחירה וסמן בגוף המסמך, והעוגן היה מכניס את הטקסט למסמך במקום להערה.
            logging.info("word body anchor dropped: %s", "comment editor has the keyboard" if self.comment_scan else "scan result unknown")
            self.word = None
        if self.word:
            for attempt in (1, 2, 3):
                try:
                    self._word_insert(text)
                    return "word"
                except Exception as e:
                    logging.info("word insert attempt %d failed: %s", attempt, type(e).__name__)
                    time.sleep(0.25)
            self.word = None
            return self._hold(text)      # Word לא נענה (חלון דו-שיח פתוח וכדומה): לא מדביקים בעיוורון
        fg = user32.GetForegroundWindow()
        want = self.target if (self.cfg.get("lock_target", True) and self.target
                               and user32.IsWindow(self.target)) else None
        if want and fg != want:
            # SwitchToThisWindow עובד גם מתהליך שאינו בחזית, בשונה מ-SetForegroundWindow
            user32.SwitchToThisWindow(want, True)
            time.sleep(0.2)
        elif (not fg or fg == self.my_hwnd) and self.last_fg:
            user32.SetForegroundWindow(self.last_fg)
            time.sleep(0.15)
        if want and self._moved() and not self._uia_refocus():
            return self._hold(text)
        old = None
        if self.cfg.get("restore_clipboard"):
            try:
                old = pyperclip.paste()
            except Exception:
                old = None
        self.clicked = False
        clip_copy(text)
        time.sleep(0.05)
        keyboard.send("ctrl+v")
        time.sleep(0.15)
        if want:                         # ההדבקה שלנו הזיזה את הסמן: זה הבסיס החדש להשוואה
            self.base_focus, self.base_caret = focus_and_caret(self.target)
        if old is not None:
            time.sleep(0.45)
            pyperclip.copy(old)
        return "pasted"


# ----------------------------- הכפתור המרחף -----------------------------
class Widget:
    TRANSPARENT = "#010203"

    def __init__(self, cfg, on_toggle, on_quit, on_settings, on_dictionary=None, on_file=None, on_update=None, on_recent=None):
        import tkinter as tk
        self.cfg = cfg
        self.on_toggle = on_toggle
        self.size = int(cfg.get("widget_size", 64))
        self.h = self.size + 18
        self.state = "loading"
        self.pulse = False
        self.hwnd = None

        # חדות במסכים עם קנה מידה (125%/150%): להצהיר על מודעות DPI לפני יצירת החלון
        try:
            ctypes.windll.shcore.SetProcessDpiAwareness(2)
        except Exception:
            try:
                user32.SetProcessDPIAware()
            except Exception:
                pass
        try:
            dpi_scale = user32.GetDpiForSystem() / 96.0
        except Exception:
            dpi_scale = 1.0
        self.size = int(round(self.size * dpi_scale))
        self.h = self.size + int(round(18 * dpi_scale))
        self.scale = dpi_scale
        self._tk = tk
        self._ov = None            # חלונית הסטטוס (יעד, פסי קול, טיימר)
        self._ov_visible = False
        self._panel = None         # לוח הפעולות שנפתח מהכפתור הקטן שליד המיקרופון
        self._panel_visible = False
        self._panel_hide_job = None
        self._chip_hit = False
        self.on_quit, self.on_settings = on_quit, on_settings
        self.on_dictionary, self.on_file = on_dictionary, on_file
        self.on_update = on_update
        self.on_recent = on_recent
        self.on_engine = None                    # נקבע על ידי App אם המודל המהיר זמין
        self.get_engine = lambda: "accurate"

        # זהות בשורת המשימות: בלי זה חלונות התוכנה מוצגים כ"Python" עם האייקון של pythonw.exe
        try:
            ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID(APP_ID)
        except Exception:
            pass
        self.root = tk.Tk()
        self.root.title("הכתבה קולית HGJ")
        if os.path.exists(ICON_PATH):
            try:
                self.root.iconbitmap(default=ICON_PATH)   # ברירת מחדל לכל החלונות של התוכנה
            except Exception:
                pass
        self.root.overrideredirect(True)
        self.root.attributes("-topmost", True)
        self.root.attributes("-transparentcolor", self.TRANSPARENT)
        self.root.configure(bg=self.TRANSPARENT)
        self.canvas = tk.Canvas(self.root, width=self.size, height=self.h,
                                bg=self.TRANSPARENT, highlightthickness=0, cursor="hand2")
        self.canvas.pack()

        st = load_state()
        pos = cfg.get("widget_position") or st.get("pos")
        sw, sh = self.root.winfo_screenwidth(), self.root.winfo_screenheight()
        if not pos:
            pos = [sw - self.size - 36, sh - self.h - 120]
        x = min(max(0, int(pos[0])), sw - self.size)
        y = min(max(0, int(pos[1])), sh - self.h)
        self.root.geometry(f"{self.size}x{self.h}+{x}+{y}")

        self.menu = tk.Menu(self.root, tearoff=0)
        self.menu.add_command(label="הקלטה / עצירה  (" + cfg.get("hotkey", "f9").upper() + ")", command=on_toggle)
        self.menu.add_command(label="פתיחת קובץ ההגדרות", command=on_settings)
        if on_dictionary:
            self.menu.add_command(label="המילון האישי (שמות ומונחים)", command=on_dictionary)
        if on_file:
            self.menu.add_separator()
            self.menu.add_command(label="תמלול קובץ הקלטה (פגישה, שיחה)...", command=on_file)
        self.menu.add_separator()
        self.menu.add_command(label="יציאה", command=on_quit)

        self._press_xy = None
        self._moved = False
        self.canvas.bind("<ButtonPress-1>", self._press)
        self.canvas.bind("<B1-Motion>", self._drag)
        self.canvas.bind("<ButtonRelease-1>", self._release)
        self.canvas.bind("<Button-3>", lambda e: self.menu.tk_popup(e.x_root, e.y_root))

        self.draw()
        self.root.after(80, self._apply_window_styles)
        self.root.after(450, self._animate)

    # --- לוח פעולות: כפתור קטן בפינת המיקרופון פותח שורת אייקונים לצידו ---
    def _chip_box(self):
        """מלבן הכפתור הקטן (שלוש נקודות) בפינה השמאלית העליונה של העיגול."""
        r = int(11 * self.scale)
        return (0, 0, 2 * r, 2 * r)

    def _in_chip(self, x, y):
        x0, y0, x1, y1 = self._chip_box()
        return x0 <= x <= x1 and y0 <= y <= y1

    def _panel_items(self):
        items = [("mic", "הקלטה", self.on_toggle)]
        if self.on_file:
            items.append(("file", "תמלול קובץ", self.on_file))
        if self.on_dictionary:
            items.append(("dict", "מילון", self.on_dictionary))
        if self.on_recent:
            items.append(("history", "אחרונות", self.on_recent))
        items.append(("settings", "הגדרות", self.on_settings))
        if self.on_update:
            items.append(("update", "עדכונים", self.on_update))
        items.append(("exit", "יציאה", self.on_quit))
        return items

    def _ensure_panel(self):
        if self._panel is not None:
            return
        tk = self._tk
        s = self.scale
        self._row_h, self._panel_w, self._pad = int(32 * s), int(188 * s), int(6 * s)
        self._seg_h = int(58 * s) if self.on_engine else 0          # שורת בורר המודל
        self._panel_h = self._pad * 2 + self._seg_h + len(self._panel_items()) * self._row_h + int(7 * s)
        p = tk.Toplevel(self.root)
        p.overrideredirect(True)
        p.attributes("-topmost", True)
        p.attributes("-transparentcolor", self.TRANSPARENT)
        p.configure(bg=self.TRANSPARENT)
        self._pc = tk.Canvas(p, width=self._panel_w, height=self._panel_h,
                             bg=self.TRANSPARENT, highlightthickness=0, cursor="hand2")
        self._pc.pack()
        self._pc.bind("<Button-1>", self._panel_click)
        self._pc.bind("<Motion>", self._panel_motion)
        self._pc.bind("<Enter>", lambda e: self._panel_arm_hide(None))
        self._pc.bind("<Leave>", lambda e: self._panel_arm_hide(2500))
        p.withdraw()
        self._panel = p
        self._panel_hover = None

    @staticmethod
    def _round_rect(c, x0, y0, x1, y1, r, fill):
        pts = [x0 + r, y0, x1 - r, y0, x1, y0, x1, y0 + r, x1, y1 - r, x1, y1,
               x1 - r, y1, x0 + r, y1, x0, y1, x0, y1 - r, x0, y0 + r, x0, y0]
        c.create_polygon(pts, smooth=True, fill=fill, outline="")

    def _row_y(self, i):
        """ראש השורה ה-i. לפני "יציאה" יש רווח קטן לקו מפריד."""
        extra = int(7 * self.scale) if i == len(self._panel_items()) - 1 else 0
        return self._pad + self._seg_h + i * self._row_h + extra

    def _seg_boxes(self):
        """מלבני שני הכפתורים של בורר המודל: מדויק מימין, מהיר משמאל."""
        s, w, pad = self.scale, self._panel_w, self._pad
        y0, y1 = pad + int(22 * s), pad + int(48 * s)
        mid = w // 2
        return {"accurate": (mid + int(2 * s), y0, w - pad - int(4 * s), y1),
                "fast": (pad + int(4 * s), y0, mid - int(2 * s), y1)}

    def _draw_panel(self):
        c, s = self._pc, self.scale
        c.delete("all")
        w, h, pad = self._panel_w, self._panel_h, self._pad
        ink, soft, accent, line = "#1F2937", "#64748B", "#0F766E", "#E5E9F0"
        r = int(10 * s)
        self._round_rect(c, 0, 0, w, h, r, "#CBD2DC")
        self._round_rect(c, 1, 1, w - 1, h - 1, r, "#FFFFFF")
        font = ("Segoe UI", max(8, int(9.5 * s)))
        if self._seg_h:
            c.create_text(w - pad - int(8 * s), pad + int(10 * s), text="מודל התמלול", fill=soft, anchor="e",
                          font=("Segoe UI", max(7, int(8 * s)), "bold"))
            cur = self.get_engine()
            for key, label in (("accurate", "מדויק"), ("fast", "מהיר")):
                x0, y0, x1, y1 = self._seg_boxes()[key]
                on = key == cur
                hov = self._panel_hover == ("engine", key)
                self._round_rect(c, x0, y0, x1, y1, int(7 * s), accent if on else ("#E2E8F0" if hov else "#F1F5F9"))
                c.create_text((x0 + x1) / 2, (y0 + y1) / 2, text=label, fill="#FFFFFF" if on else ink,
                              font=("Segoe UI", max(8, int(9.5 * s)), "bold" if on else "normal"))
            c.create_line(pad + int(6 * s), pad + self._seg_h - int(3 * s), w - pad - int(6 * s),
                          pad + self._seg_h - int(3 * s), fill=line)
        items = self._panel_items()
        for i, (key, label, _cb) in enumerate(items):
            y = self._row_y(i)
            if key == "exit":
                c.create_line(pad + int(6 * s), y - int(4 * s), w - pad - int(6 * s), y - int(4 * s), fill=line)
            if self._panel_hover == ("item", i):
                self._round_rect(c, pad, y + 1, w - pad, y + self._row_h - 1, int(6 * s), "#F1F5F9")
            color = "#B42318" if key == "exit" else (accent if key == "mic" else ink)
            if key == "mic" and self.state in ("recording", "speech"):
                key, label, color = "stop", "עצירה", "#E03131"
            cy = y + self._row_h / 2
            c.create_text(w - pad - int(18 * s), cy, text=MDL2[key], fill=color,
                          font=("Segoe MDL2 Assets", max(10, int(12 * s))))
            c.create_text(w - pad - int(38 * s), cy, text=label, fill=color if key in ("exit", "stop") else ink,
                          anchor="e", font=font)

    def _panel_hit(self, x, y):
        if self._seg_h:
            for key, (x0, y0, x1, y1) in self._seg_boxes().items():
                if x0 <= x <= x1 and y0 <= y <= y1:
                    return ("engine", key)
        if self._pad <= x <= self._panel_w - self._pad:
            for i in range(len(self._panel_items())):
                y0 = self._row_y(i)
                if y0 <= y < y0 + self._row_h:
                    return ("item", i)
        return None

    def _panel_motion(self, e):
        hit = self._panel_hit(e.x, e.y)
        if hit != self._panel_hover:
            self._panel_hover = hit
            self._draw_panel()

    def _panel_click(self, e):
        hit = self._panel_hit(e.x, e.y)
        if not hit:
            return
        if hit[0] == "engine":
            if self.on_engine:
                self.on_engine(hit[1])           # הלוח נשאר פתוח, כדי שרואים שהבחירה התחלפה
            self._draw_panel()
            self._panel_arm_hide(4000)
            return
        self.panel_hide()
        self._panel_items()[hit[1]][2]()

    def _panel_arm_hide(self, ms):
        if self._panel_hide_job:
            self.root.after_cancel(self._panel_hide_job)
            self._panel_hide_job = None
        if ms:
            self._panel_hide_job = self.root.after(ms, self.panel_hide)

    def panel_toggle(self):
        if self._panel_visible:
            self.panel_hide()
            return
        self._ensure_panel()
        self._panel_hover = None
        self._draw_panel()
        sw = self.root.winfo_screenwidth()
        bx, by = self.root.winfo_x(), self.root.winfo_y()
        gap = int(8 * self.scale)
        x = bx - self._panel_w - gap                    # משמאל למיקרופון (הכפתור בדרך כלל בקצה הימני של המסך)
        if x < 4:
            x = min(bx + self.size + gap, sw - self._panel_w - 4)
        # תחתית התפריט מיושרת לתחתית הכפתור, כך שהוא נפתח כלפי מעלה ולא מסתיר את מה שמתחת
        y = min(max(4, by + self.size - self._panel_h), self.root.winfo_screenheight() - self._panel_h - 4)
        self._panel.geometry(f"{self._panel_w}x{self._panel_h}+{x}+{y}")
        self._panel.deiconify()
        self._panel.lift()
        self._panel_visible = True
        self._panel.after(60, lambda: self._no_activate(self._panel))
        self._panel_arm_hide(6000)                      # נסגר לבד אם לא נוגעים בו

    def panel_hide(self):
        self._panel_arm_hide(None)
        if self._panel is not None and self._panel_visible:
            self._panel.withdraw()
            self._panel_visible = False
        self.draw()


    @staticmethod
    def _no_activate(widget):
        child = widget.winfo_id()
        parent = user32.GetParent(child)
        for h in {child, parent or child}:
            ex = user32.GetWindowLongW(h, GWL_EXSTYLE)
            want = ex | WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW
            if want != ex:
                user32.SetWindowLongW(h, GWL_EXSTYLE, want)
        return parent or child

    def _apply_window_styles(self):
        # Tk כותב מחדש את הסגנונות המורחבים בכל עדכון שלו (שקיפות, topmost),
        # לכן הפונקציה נקראת גם מכל פעימת אנימציה ומחזירה את הדגל אם נעלם.
        self.hwnd = self._no_activate(self.root)
        if self._ov is not None:
            self._no_activate(self._ov)
        if self._panel is not None:
            self._no_activate(self._panel)

    # --- חלונית סטטוס: לאן נכתב, פסי קול חיים, טיימר ---
    def _ensure_overlay(self):
        if self._ov is not None:
            return
        tk = self._tk
        s = self.scale
        self._ov_w, self._ov_h = int(300 * s), int(70 * s)
        ov = tk.Toplevel(self.root)
        ov.overrideredirect(True)
        ov.attributes("-topmost", True)
        ov.attributes("-transparentcolor", self.TRANSPARENT)
        ov.configure(bg=self.TRANSPARENT)
        self._ovc = tk.Canvas(ov, width=self._ov_w, height=self._ov_h,
                              bg=self.TRANSPARENT, highlightthickness=0)
        self._ovc.pack()
        # לחיצה על הודעת "הסמן זז" פותחת את ההכתבות האחרונות, שם הטקסט עצמו
        self._ovc.bind("<Button-1>", lambda e: self.on_recent() if (self._ov_mode == "held" and self.on_recent) else None)
        ov.withdraw()
        self._ov = ov
        self._levels = [0.0] * 11
        self._ov_start = time.time()
        self._ov_target = ""
        self._ov_mode = "wait"

    def overlay_show(self, target_title, mode):
        """mode: wait (מחכה לדיבור), speech (מקשיב), transcribing (מסיים), held (הסמן זז, הטקסט בלוח)."""
        self._ensure_overlay()
        self._ov_target = target_title or ""
        self._ov_mode = mode
        if not self._ov_visible:
            self._ov_start = time.time()
            self._levels = [0.0] * len(self._levels)
            # מעל הכפתור, ממורכז אליו, ובתוך המסך
            sw = self.root.winfo_screenwidth()
            bx, by = self.root.winfo_x(), self.root.winfo_y()
            x = min(max(4, bx + self.size // 2 - self._ov_w // 2), sw - self._ov_w - 4)
            y = by - self._ov_h - int(8 * self.scale)
            if y < 4:
                y = by + self.h + int(8 * self.scale)
            self._ov.geometry(f"{self._ov_w}x{self._ov_h}+{x}+{y}")
            self._ov.deiconify()
            self._ov.lift()
            self._ov_visible = True
            self._ov.after(60, lambda: self._no_activate(self._ov))
        self._draw_overlay()

    def overlay_hide(self):
        if self._ov is not None and self._ov_visible:
            self._ov.withdraw()
            self._ov_visible = False

    def overlay_level(self, rms):
        if self._ov_visible:
            self._levels = self._levels[1:] + [float(rms)]
            self._draw_overlay()

    def _draw_overlay(self):
        if not self._ov_visible:
            return
        c, w, h, s = self._ovc, self._ov_w, self._ov_h, self.scale
        c.delete("all")
        bg, ink, soft, bar = "#1B2440", "#F1F4FA", "#9AA6C2", "#4FD1C5"
        r = h // 2
        c.create_oval(0, 0, h, h, fill=bg, outline="")
        c.create_oval(w - h, 0, w, h, fill=bg, outline="")
        c.create_rectangle(r, 0, w - r, h, fill=bg, outline="")
        if self._ov_mode == "held":
            # הסמן זז בזמן ההכתבה: הטקסט לא הודבק אלא מחכה בלוח
            c.create_text(w - int(22 * s), int(22 * s), text="הסמן זז, לא הדבקתי. לחיצה לטקסט", fill="#FBBF24", anchor="e",
                          font=("Segoe UI", max(8, int(9.5 * s)), "bold"))
            c.create_text(w - int(22 * s), int(47 * s), text="הטקסט בלוח. להדבקה במקום הרצוי", fill=ink, anchor="e",
                          font=("Segoe UI", max(8, int(9 * s))))
            bbox = c.bbox(c.find_all()[-1])
            c.create_text(bbox[0] - int(6 * s), int(47 * s), text="Ctrl+V", fill=bar, anchor="e",
                          font=("Segoe UI", max(8, int(9 * s)), "bold"))
            return
        # שורה עליונה: היעד (מימין, בעברית) ושם החלון
        top = int(20 * s)
        label = "מתמלל…" if self._ov_mode == "transcribing" else "מקליד אל"
        c.create_text(w - int(22 * s), top, text=label, fill=soft, anchor="e",
                      font=("Segoe UI", max(8, int(8.5 * s)), "bold"))
        if self._ov_mode != "transcribing" and self._ov_target:
            t = self._ov_target
            t = t if len(t) <= 30 else t[:14] + "…" + t[-14:]
            bbox = c.bbox(c.find_all()[-1])
            c.create_text(bbox[0] - int(8 * s), top, text=t, fill=ink, anchor="e",
                          font=("Segoe UI", max(8, int(9 * s))))
        # שורה תחתונה: נקודה, פסים, טיימר
        bot = int(47 * s)
        dot = "#E03131" if self._ov_mode == "speech" else ("#D97706" if self._ov_mode == "transcribing" else "#7F8CA8")
        if self._ov_mode != "speech" or int(time.time() * 2) % 2 == 0:
            c.create_oval(w - int(34 * s), bot - int(7 * s), w - int(20 * s), bot + int(7 * s), fill=dot, outline="")
        n = len(self._levels)
        ref = max(0.02, max(self._levels) * 1.15)
        bw, gap = int(5 * s), int(4 * s)
        x = w - int(48 * s)
        for i in range(n):
            v = self._levels[i] / ref if self._ov_mode != "transcribing" else 0.35 + 0.35 * ((i + int(time.time() * 6)) % 3 == 0)
            bh = max(int(4 * s), int(v * 26 * s))
            c.create_rectangle(x - bw, bot - bh // 2, x, bot + bh // 2, fill=bar if v > 0.15 else soft, outline="")
            x -= bw + gap
        secs = int(time.time() - self._ov_start)
        c.create_text(int(22 * s), bot, text=f"{secs // 60}:{secs % 60:02d}", fill=ink, anchor="w",
                      font=("Segoe UI", max(9, int(10 * s)), "bold"))

    # --- גרירה מול לחיצה ---
    def _press(self, e):
        self._press_xy = (e.x_root, e.y_root, self.root.winfo_x(), self.root.winfo_y())
        self._moved = False
        self._chip_hit = self._in_chip(e.x, e.y)

    def _drag(self, e):
        if not self._press_xy:
            return
        x0, y0, wx, wy = self._press_xy
        dx, dy = e.x_root - x0, e.y_root - y0
        if abs(dx) > 3 or abs(dy) > 3:
            self._moved = True
            self.root.geometry(f"+{wx + dx}+{wy + dy}")

    def _release(self, e):
        if self._moved:
            st = load_state()
            st["pos"] = [self.root.winfo_x(), self.root.winfo_y()]
            save_state(st)
        elif self._chip_hit:
            self.panel_toggle()
        else:
            self.panel_hide()
            self.on_toggle()
        self._press_xy = None
        self._chip_hit = False

    # --- חלון התקדמות: הורדת המודל בהפעלה הראשונה, ותמלול קובץ (עם עצירה ופתיחת התמלול החלקי) ---
    def show_progress(self, pct, text, title="הכתבה קולית HGJ", on_cancel=None, on_open=None):
        import tkinter as tk
        from tkinter import ttk
        if not getattr(self, "_prog", None):
            w = tk.Toplevel(self.root)
            w.title(title)
            w.attributes("-topmost", True)
            w.resizable(False, False)
            sw, sh = self.root.winfo_screenwidth(), self.root.winfo_screenheight()
            w.geometry(f"520x170+{sw // 2 - 260}+{sh // 2 - 85}")
            # סגירה בכפתור החלון = עצירה כשיש מה לעצור, אחרת מתעלמים (הורדת המודל חייבת להסתיים)
            w.protocol("WM_DELETE_WINDOW", lambda: (on_cancel or (lambda: None))())
            self._prog_label = tk.Label(w, text="", font=("Segoe UI", 10), justify="right",
                                        anchor="e", wraplength=490)
            self._prog_label.pack(fill="x", padx=14, pady=(14, 6))
            self._prog_bar = ttk.Progressbar(w, maximum=100, length=490)
            self._prog_bar.pack(padx=14, pady=(0, 10))
            row = tk.Frame(w)
            row.pack(fill="x", padx=14, pady=(0, 12))
            if on_cancel:
                tk.Button(row, text="עצירה (שומר את מה שתומלל עד עכשיו)", command=on_cancel,
                          font=("Segoe UI", 9)).pack(side="right")
            if on_open:
                tk.Button(row, text="פתיחת התמלול החלקי", command=on_open,
                          font=("Segoe UI", 9)).pack(side="right", padx=(0, 8))
            self._prog = w
        self._prog_label.config(text=text)
        self._prog_bar["value"] = pct

    def hide_progress(self):
        if getattr(self, "_prog", None):
            self._prog.destroy()
            self._prog = None

    # --- ציור ---
    def set_state(self, state):
        self.state = state
        self.draw()

    @staticmethod
    def _shade(hex_color, f):
        """מבהיר (f חיובי) או מכהה (f שלילי) צבע."""
        r, g, b = (int(hex_color[i:i + 2], 16) for i in (1, 3, 5))
        t = 255 if f > 0 else 0
        f = abs(f)
        return "#%02X%02X%02X" % tuple(int(v + (t - v) * f) for v in (r, g, b))

    def draw(self):
        c, s = self.canvas, self.size
        c.delete("all")
        color, label = COLORS.get(self.state, COLORS["idle"])
        u = s / 64.0
        pad = int(5 * u)
        if self.state in ("recording", "speech") and self.pulse:
            c.create_oval(1, 1, s - 1, s - 1, outline=color, width=2)
        # עומק: צל כהה מתחת, ומעליו מעבר צבע מהשוליים הכהים אל נקודת אור למעלה משמאל
        c.create_oval(pad, pad + 2 * u, s - pad, s - pad + 2 * u, fill=self._shade(color, -0.45), outline="")
        steps = 16
        R = (s - 2 * pad) / 2.0
        cx0 = cy0 = s / 2.0
        for k in range(steps):
            t = k / (steps - 1.0)
            rr = R * (1 - 0.62 * t)
            cx, cy = cx0 - R * 0.16 * t, cy0 - R * 0.22 * t
            c.create_oval(cx - rr, cy - rr, cx + rr, cy + rr, outline="",
                          fill=self._shade(color, -0.14 + 0.36 * t))
        # גליף מיקרופון בלבן
        cx = s / 2
        w = max(2, int(3 * u))
        c.create_oval(cx - 7 * u, 14 * u, cx + 7 * u, 34 * u, fill="white", outline="")
        c.create_arc(cx - 13 * u, 18 * u, cx + 13 * u, 43 * u, start=180, extent=180,
                     style="arc", outline="white", width=w)
        c.create_line(cx, 43 * u, cx, 50 * u, fill="white", width=w)
        c.create_line(cx - 6 * u, 50 * u, cx + 6 * u, 50 * u, fill="white", width=w)
        if label:
            c.create_text(cx, s + int(8 * u), text=label, fill=color, font=("Segoe UI", 8, "bold"))
        # כפתור קטן (שלוש נקודות) בפינה: לחיצה פותחת את התפריט. לחיצה על העיגול עצמו = הקלטה
        x0, y0, x1, y1 = self._chip_box()
        chip_bg = "#1F2937" if self._panel_visible else "#FFFFFF"
        chip_fg = "#FFFFFF" if self._panel_visible else "#374151"
        c.create_oval(x0, y0 + 1, x1, y1 + 1, fill="#AEB6C2", outline="")
        c.create_oval(x0, y0, x1, y1, fill=chip_bg, outline="#C9CFD8")
        cxx, cyy, d = (x0 + x1) / 2, (y0 + y1) / 2, max(1.5, 1.6 * u)
        for k in (-1, 0, 1):
            c.create_oval(cxx + k * 3.2 * d - d, cyy - d, cxx + k * 3.2 * d + d, cyy + d, fill=chip_fg, outline="")

    def _animate(self):
        if self.state in ("recording", "speech", "transcribing"):
            self.pulse = not self.pulse
            self.draw()
            self._draw_overlay()          # מעדכן טיימר ואנימציה גם בלי אודיו
            if self._panel_visible:
                self._draw_panel()
        if self.hwnd:
            self._apply_window_styles()
        self.root.after(450, self._animate)


# ----------------------------- האפליקציה -----------------------------
class App:
    def __init__(self):
        setup_logging()
        self.cfg = load_config()
        self.ui = queue.Queue()
        self.state = "loading"

        # מופע יחיד
        self._mutex = kernel32.CreateMutexW(None, False, "HGJ-Dictation-Desktop-Mutex")
        if ctypes.get_last_error() == 183:  # ERROR_ALREADY_EXISTS
            import tkinter.messagebox as mb
            mb.showinfo("הכתבה קולית", "הכלי כבר פועל. חפשו את כפתור המיקרופון על המסך.")
            sys.exit(0)

        ensure_dictionary()
        self.widget = Widget(self.cfg, self.toggle, self.quit, self.open_settings,
                             self.open_dictionary, self.transcribe_file_dialog, self.check_updates_manual, self.open_recent)
        self.recent = []             # חמש ההכתבות האחרונות, בזיכרון בלבד: לא נכתבות לדיסק ולא ליומן
        if self.cfg.get("fast_model") and fast_available():
            self.widget.get_engine = lambda: self.cfg.get("engine", "accurate")
            self.widget.on_engine = self.set_engine
        self._update_busy = False
        if self.cfg.get("check_updates", True):
            threading.Timer(30.0, self._check_updates_auto).start()
        self.typer = Typer(self.cfg)
        self._notice_until = 0.0     # עד מתי מוצגת הודעת "הסמן זז"
        self._in_poll = False
        self.model_lock = threading.Lock()   # תמלול מיקרופון ותמלול קובץ לא רצים על המודל בו-זמנית
        self.recorder = Recorder(self.cfg, self._on_segment, self._on_end,
                                 lambda s: self.ui.put(("state", s)),
                                 on_level=lambda v: self.ui.put(("level", v)))
        self.transcriber = Transcriber(self.cfg)
        # תור תמלול: מקטעים מתומללים ומודבקים לפי הסדר, בזמן שההאזנה ממשיכה
        self.jobs = queue.Queue()
        self.pending = 0
        self.pending_lock = threading.Lock()
        threading.Thread(target=self._transcribe_worker, daemon=True).start()

        threading.Thread(target=self._load_model, daemon=True).start()
        try:
            import keyboard
            self._hotkey_handle = keyboard.add_hotkey(self.cfg.get("hotkey", "f9"), lambda: self.ui.put(("toggle", None)))
        except Exception as e:
            logging.error("hotkey failed: %s", e)
        self.widget.root.after(100, self._poll)
        logging.info("started")

    def run(self):
        self.widget.root.mainloop()

    def demo(self):
        """הדגמת המצבים בלי מיקרופון (לבדיקת ממשק): מחכה לדיבור, מקשיב עם פסים, מתמלל, חזרה."""
        import random
        root = self.widget.root
        self.typer.target = user32.GetForegroundWindow()

        def at(ms, kind, payload):
            root.after(ms, lambda: self.ui.put((kind, payload)))
        at(500, "state", "recording")
        for i in range(30):
            at(1500 + i * 100, "level", random.uniform(0.02, 0.25) if i % 7 else 0.004)
        at(1500, "state", "speech")
        at(4600, "state", "recording")
        at(6000, "state", "transcribing")
        at(9000, "state", "idle")
        root.after(9500, self.widget.panel_toggle)
        root.after(10000, self.open_settings)
        root.after(10500, lambda: self._show_update_result("available", {"version": "9.9.9", "notes": "הדגמה: כך נראית הודעת עדכון."}, False, False))
        root.after(16000, self.quit)
        root.mainloop()

    def _poll(self):
        # קריאת COM ל-Word מריצה לולאת הודעות פנימית, ו-Tk עלול להפעיל את _poll שוב מתוכה. לא נכנסים פעמיים.
        if self._in_poll:
            return
        self._in_poll = True
        try:
            self._poll_once()
        finally:
            self._in_poll = False
        try:
            self.widget.root.after(100, self._poll)
        except Exception:
            pass                     # החלון נסגר (יציאה)

    def _poll_once(self):
        self.typer.my_hwnd = self.widget.hwnd
        self.typer.track()
        while True:
            try:
                kind, payload = self.ui.get_nowait()
            except queue.Empty:
                break
            if kind == "state":
                self.state = payload
                self.widget.set_state(payload)
                if payload == "idle":
                    self.typer.end_session()
                self._sync_overlay()
            elif kind == "state_if":
                if self.state == payload[0]:
                    self.state = payload[1]
                    self.widget.set_state(payload[1])
                    if payload[1] == "idle":
                        self.typer.end_session()
                    self._sync_overlay()
            elif kind == "level":
                self.widget.overlay_level(payload)
            elif kind == "progress":
                if payload is None:
                    self.widget.hide_progress()
                else:
                    self.widget.show_progress(payload[0], payload[1], **(payload[2] if len(payload) > 2 else {}))
            elif kind == "open":
                try:
                    os.startfile(payload)
                except Exception as e:
                    logging.error("open failed: %s", e)
            elif kind == "error_msg":
                import tkinter.messagebox as mb
                mb.showerror("הכתבה קולית", payload)
            elif kind == "toggle":
                self.toggle()
            elif kind == "type":
                try:
                    result = self.typer.type_text(payload)
                    self.recent.insert(0, (time.strftime("%H:%M"), payload, result))
                    del self.recent[5:]
                    if result == "held":
                        self._notice_until = time.time() + 15
                        self._sync_overlay()
                        self.widget.root.after(15200, self._sync_overlay)
                except Exception as e:
                    logging.error("type failed: %s", e)
            elif kind == "update_result":
                self._show_update_result(*payload)
            elif kind == "update_apply_done":
                self._finish_update(payload)
            elif kind == "fatal":
                import tkinter.messagebox as mb
                mb.showerror("הכתבה קולית", payload)
                self.quit()
                return

    def _sync_overlay(self):
        """חלונית הסטטוס מוצגת רק בזמן האזנה ותמלול, ומראה לאן הטקסט ייכתב."""
        if self.typer.hold and time.time() < self._notice_until:
            self.widget.overlay_show(window_title(self.typer.target), "held")
        elif self.state in ("recording", "speech"):
            self.widget.overlay_show(window_title(self.typer.target),
                                     "speech" if self.state == "speech" else "wait")
        elif self.state == "transcribing":
            self.widget.overlay_show(window_title(self.typer.target), "transcribing")
        else:
            self.widget.overlay_hide()

    def _load_model(self):
        try:
            if not os.path.exists(os.path.join(self.cfg["model_dir"], "model.bin")):
                # הפעלה ראשונה: הורדת מודל השפה (כ-1.6GB) עם חלון התקדמות
                import download_model
                logging.info("model missing, downloading to %s", self.cfg["model_dir"])
                self.ui.put(("progress", (0, "מוריד את מודל השפה בעברית (1.6GB). פעם אחת בלבד, לפי מהירות הרשת.")))
                download_model.download(
                    lambda pct, name: self.ui.put(("progress", (pct, f"מוריד {name}: {pct}%"))),
                    dest=self.cfg["model_dir"])
                self.ui.put(("progress", None))
            t = time.time()
            self.transcriber.load()
            logging.info("model loaded in %.1fs", time.time() - t)
            self.ui.put(("state", "idle"))
        except Exception as e:
            logging.exception("model load failed")
            self.ui.put(("progress", None))
            self.ui.put(("fatal", "לא ניתן לטעון את מודל השפה.\n" + str(e)))

    def toggle(self):
        if self.state == "loading":
            return
        if self.recorder.running:
            self.recorder.stop()
        else:
            self._notice_until = 0.0
            self.typer.lock_target()
            self.recorder.start()
            self.ui.put(("state", "recording"))

    def _on_segment(self, audio):
        with self.pending_lock:
            self.pending += 1
        self.jobs.put(audio)

    def _on_end(self, had_speech):
        if not had_speech:
            self.ui.put(("state", "nospeech"))
            threading.Timer(2.0, lambda: self.ui.put(("state_if", ("nospeech", "idle")))).start()
            return
        with self.pending_lock:
            busy = self.pending > 0
        self.ui.put(("state", "transcribing" if busy else "idle"))

    def _transcribe_worker(self):
        while True:
            audio = self.jobs.get()
            try:
                t = time.time()
                with self.model_lock:
                    text = self.transcriber.transcribe(audio)
                logging.info("transcribed %.1fs of audio in %.2fs: %d chars",
                             len(audio) / SAMPLE_RATE, time.time() - t, len(text))
                if text:
                    self.ui.put(("type", text))
            except Exception:
                logging.exception("transcribe failed")
            with self.pending_lock:
                self.pending -= 1
                done = self.pending <= 0
            if done and not self.recorder.running:
                self.ui.put(("state_if", ("transcribing", "idle")))

    def open_settings(self):
        """חלון הגדרות פשוט לשימוש היומיומי. הקובץ המלא (config.json) נשאר למי שצריך את הכל."""
        import tkinter as tk
        from tkinter import ttk
        if getattr(self, "_settings_win", None) and self._settings_win.winfo_exists():
            self._settings_win.lift()
            return
        cfg = self.cfg
        w = tk.Toplevel(self.widget.root)
        w.title("הגדרות הכתבה קולית HGJ")
        w.attributes("-topmost", True)
        w.resizable(False, False)
        self._settings_win = w
        f = ttk.Frame(w, padding=16)
        f.pack(fill="both", expand=True)
        rows = []

        def row(label, widget_factory, note=""):
            r = len(rows)
            ttk.Label(f, text=label, anchor="e", justify="right").grid(row=r, column=1, sticky="e", padx=(12, 0), pady=5)
            wd = widget_factory(f)
            wd.grid(row=r, column=0, sticky="ew", pady=5)
            if note:
                ttk.Label(f, text=note, foreground="#64748B", anchor="e", justify="right",
                          font=("Segoe UI", 8)).grid(row=r + 1, column=0, columnspan=2, sticky="e")
                rows.append(None)
            rows.append(wd)
            return wd

        # מיקרופון
        devices = [(None, "ברירת המחדל של Windows")]
        try:
            devices += list_input_devices()
        except Exception as e:
            logging.error("device list failed: %s", e)
        dev_names = [n for _i, n in devices]
        cur = cfg.get("input_device")
        cur_name = dev_names[0]
        for i, n in devices:
            if cur is not None and (cur == i or (isinstance(cur, str) and cur and cur.lower() in n.lower())):
                cur_name = n
        dev_var = tk.StringVar(value=cur_name)
        row("מיקרופון", lambda p: ttk.Combobox(p, textvariable=dev_var, values=dev_names, state="readonly", width=44),
            "אם ההכתבה לא קולטת דיבור, בדרך כלל זה מיקרופון של מצלמת רשת שנבחר כברירת מחדל")
        # מקש קיצור
        hot_var = tk.StringVar(value=cfg.get("hotkey", "f9"))
        row("מקש קיצור להקלטה", lambda p: ttk.Entry(p, textvariable=hot_var, width=20),
            "למשל f9, f8, ctrl+alt+d, scroll lock")
        # שקט
        seg_var = tk.DoubleVar(value=float(cfg.get("segment_silence_seconds", 1.5)))
        row("שקט שמסיים משפט (שניות)", lambda p: ttk.Spinbox(p, from_=0.5, to=5.0, increment=0.25, textvariable=seg_var, width=8),
            "אחרי שקט כזה המשפט נשלח לתמלול ומוקלד, וההאזנה ממשיכה")
        end_var = tk.IntVar(value=int(cfg.get("end_silence_seconds", 15)))
        row("שקט שמסיים את ההקלטה (שניות)", lambda p: ttk.Spinbox(p, from_=3, to=120, increment=1, textvariable=end_var, width=8),
            "כדי שההקלטה לא תישאר פתוחה כשמפסיקים לדבר")
        # נעילת יעד
        lock_var = tk.BooleanVar(value=bool(cfg.get("lock_target", True)))
        row("להקליד לחלון שהיה פעיל בתחילת ההקלטה", lambda p: ttk.Checkbutton(p, variable=lock_var),
            "מסומן: אפשר לעבור לחלונות אחרים בזמן הדיבור, הטקסט ייכנס לחלון המקורי")
        upd_var = tk.BooleanVar(value=bool(cfg.get("check_updates", True)))
        row("לבדוק עדכונים פעם ביום", lambda p: ttk.Checkbutton(p, variable=upd_var),
            "קריאה אחת לאתר הכלים של המשרד לקובץ גרסה. לא נשלח שום מידע. אפשר גם ידנית מלוח הפעולות")
        # גודל הכפתור
        size_var = tk.IntVar(value=int(cfg.get("widget_size", 64)))
        row("גודל כפתור המיקרופון", lambda p: ttk.Spinbox(p, from_=40, to=120, increment=8, textvariable=size_var, width=8),
            "נכנס לתוקף בהפעלה הבאה")

        status = ttk.Label(f, text="", foreground="#0F766E", anchor="e")
        status.grid(row=len(rows) + 1, column=0, columnspan=2, sticky="e", pady=(8, 0))

        def save():
            try:
                chosen = dev_var.get()
                idx = next((i for i, n in devices if n == chosen), None)
                # שומרים את שם המכשיר ולא את האינדקס: אינדקסים משתנים בין הפעלות
                cfg["input_device"] = None if idx is None else chosen
                new_hot = hot_var.get().strip().lower() or "f9"
                cfg["segment_silence_seconds"] = float(seg_var.get())
                cfg["end_silence_seconds"] = int(end_var.get())
                cfg["lock_target"] = bool(lock_var.get())
                cfg["widget_size"] = int(size_var.get())
                cfg["check_updates"] = bool(upd_var.get())
                if new_hot != cfg.get("hotkey"):
                    import keyboard
                    try:
                        keyboard.remove_hotkey(self._hotkey_handle)
                    except Exception:
                        pass
                    self._hotkey_handle = keyboard.add_hotkey(new_hot, lambda: self.ui.put(("toggle", None)))
                    cfg["hotkey"] = new_hot
                save_config(cfg)
                status.config(text="נשמר. ההגדרות בתוקף מההקלטה הבאה.")
                logging.info("settings saved: %s", {k: cfg[k] for k in ("input_device", "hotkey", "segment_silence_seconds", "end_silence_seconds", "lock_target", "widget_size")})
            except Exception as e:
                logging.exception("settings save failed")
                status.config(text=f"שגיאה בשמירה: {e}", foreground="#B42318")

        btns = ttk.Frame(f)
        btns.grid(row=len(rows) + 2, column=0, columnspan=2, sticky="ew", pady=(14, 0))
        ttk.Button(btns, text="שמירה", command=save).pack(side="right")
        ttk.Button(btns, text="סגירה", command=w.destroy).pack(side="right", padx=(0, 8))
        ttk.Button(btns, text="כל ההגדרות (קובץ טקסט)",
                   command=lambda: os.startfile("notepad.exe", arguments=f'"{CONFIG_PATH}"') if hasattr(os, "startfile") else None
                   ).pack(side="left")
        f.columnconfigure(0, weight=1)
        w.update_idletasks()
        sw, sh = w.winfo_screenwidth(), w.winfo_screenheight()
        w.geometry(f"+{sw // 2 - w.winfo_width() // 2}+{sh // 2 - w.winfo_height() // 2}")

    def set_engine(self, engine):
        """מדויק = Whisper turbo של ivrit.ai. מהיר = zipformer2 streaming של ivrit.ai. שניהם מקומיים. הבחירה נשמרת."""
        if engine not in ("accurate", "fast"):
            return
        self.cfg["engine"] = engine
        try:
            save_config(self.cfg)
        except Exception as e:
            logging.error("engine not saved: %s", e)
        logging.info("engine: %s", engine)

    def open_recent(self):
        """חמש ההכתבות האחרונות, להעתקה בלחיצה. רשת ביטחון למקרה שטקסט הודבק במקום שגוי או נדרס בלוח."""
        import tkinter as tk
        from tkinter import ttk
        import pyperclip
        if getattr(self, "_recent_win", None) and self._recent_win.winfo_exists():
            self._recent_win.destroy()
        w = tk.Toplevel(self.widget.root)
        w.title("הכתבות אחרונות - הכתבה קולית HGJ")
        w.attributes("-topmost", True)
        w.resizable(False, False)
        self._recent_win = w
        f = ttk.Frame(w, padding=14)
        f.pack(fill="both", expand=True)
        labels = {"word": "נכנס למסמך", "pasted": "הודבק", "held": "מחכה בלוח"}
        if not self.recent:
            ttk.Label(f, text="אין עדיין הכתבות מאז שהכלי הופעל.", anchor="e").pack(fill="x")
        for when, text, result in self.recent:
            row = ttk.Frame(f)
            row.pack(fill="x", pady=5)
            head = ttk.Frame(row)
            head.pack(fill="x")
            ttk.Label(head, text=f"{when} · {labels.get(result, result)}",
                      foreground="#B45309" if result == "held" else "#64748B", font=("Segoe UI", 8, "bold")).pack(side="right")

            def copy(t=text, b=None):
                clip_copy(t)
            btn = ttk.Button(head, text="העתקה", width=8)
            btn.configure(command=lambda t=text, b=btn: (clip_copy(t), b.configure(text="הועתק")))
            btn.pack(side="left")
            ttk.Label(row, text=text, wraplength=460, justify="right", anchor="e").pack(fill="x", pady=(3, 0))
            ttk.Separator(f).pack(fill="x", pady=(4, 0))
        ttk.Label(f, text="נשמר בזיכרון בלבד, ונמחק כשיוצאים מהכלי.", foreground="#64748B",
                  font=("Segoe UI", 8), anchor="e").pack(fill="x", pady=(8, 0))
        ttk.Button(f, text="סגירה", command=w.destroy).pack(side="right", pady=(8, 0))
        w.update_idletasks()
        sw, sh = w.winfo_screenwidth(), w.winfo_screenheight()
        w.geometry(f"+{sw // 2 - w.winfo_width() // 2}+{sh // 2 - w.winfo_height() // 2}")

    def open_dictionary(self):
        ensure_dictionary()
        os.startfile("notepad.exe", arguments=f'"{DICT_PATH}"')

    # --- תמלול קובץ הקלטה: מקליטים בטלפון, מתמללים במחשב, שום דבר לא עוזב אותו ---
    def transcribe_file_dialog(self):
        from tkinter import filedialog
        if self.state == "loading":
            self.ui.put(("error_msg", "המודל עדיין נטען. נסו שוב בעוד כמה שניות."))
            return
        path = filedialog.askopenfilename(
            parent=self.widget.root, title="בחירת קובץ הקלטה לתמלול",
            filetypes=[("הקלטות", "*.m4a *.mp3 *.wav *.ogg *.opus *.aac *.flac *.wma *.mp4 *.amr *.3gp"),
                       ("כל הקבצים", "*.*")])
        if path:
            if getattr(self, "_file_job_active", False):
                self.ui.put(("error_msg", "כבר רץ תמלול של קובץ. עצרו אותו קודם או חכו שיסתיים."))
                return
            threading.Thread(target=self._transcribe_file_job, args=(path,), daemon=True).start()

    def cancel_file_job(self):
        self._file_cancel = True
        self.ui.put(("progress", (None, "עוצר... שומר את מה שתומלל עד עכשיו.")))

    def _transcribe_file_job(self, path):
        name = os.path.basename(path)
        out = transcript_path(path)
        self._file_cancel = False
        self._file_job_active = True
        opts = {"title": "תמלול קובץ הקלטה", "on_cancel": self.cancel_file_job,
                "on_open": lambda: self.ui.put(("open", out))}
        where = f"התמלול נשמר ליד ההקלטה, כקובץ טקסט: {os.path.basename(out)}"

        def prog(pct, msg):
            if pct is None:
                self.ui.put(("progress", (0, msg, opts)))
            else:
                self.ui.put(("progress", (pct, f"{msg}\n{where}", opts)))
        self.ui.put(("state", "transcribing"))
        prog(0, f"מתמלל את {name}. אפשר להמשיך לעבוד, זה רץ ברקע.")
        try:
            t = time.time()
            last_write = [0.0]

            def on_line(lines, total):
                # הקובץ מתעדכן כל כמה שניות, כך שאפשר לפתוח אותו ולקרוא תוך כדי, וגם אם עוצרים לא מאבדים כלום
                if time.time() - last_write[0] > 3:
                    write_transcript(path, lines, total, status=f"בתהליך, {len(lines)} מקטעים")
                    last_write[0] = time.time()
            with self.model_lock:
                lines, total, stopped = self.transcriber.transcribe_file(
                    path, lambda pct: prog(pct, f"מתמלל את {name}: {pct}%"),
                    on_line=on_line, cancel=lambda: self._file_cancel)
            status = f"הופסק על ידי המשתמש אחרי {fmt_ts(lines[-1][0]) if lines else '0'}, תמלול חלקי" if stopped else ""
            write_transcript(path, lines, total, status=status)
            logging.info("file transcribed%s: %.0fs of audio in %.0fs, %d segments",
                         " (stopped)" if stopped else "", total, time.time() - t, len(lines))
            self.ui.put(("progress", None))
            self.ui.put(("open", out))
        except Exception as e:
            logging.exception("file transcription failed")
            self.ui.put(("progress", None))
            self.ui.put(("error_msg", f"תמלול הקובץ נכשל.\n{e}"))
        self._file_job_active = False
        self.ui.put(("state_if", ("transcribing", "idle")))

    def quit(self):
        try:
            import keyboard
            keyboard.unhook_all()
        except Exception:
            pass
        self.widget.root.destroy()

    # --- עדכונים ---
    def _check_updates_auto(self):
        st = load_state()
        if time.time() - float(st.get("last_update_check", 0)) < UPDATE_CHECK_INTERVAL:
            return
        self._check_updates(manual=False)

    def check_updates_manual(self):
        if self._update_busy:
            return
        threading.Thread(target=self._check_updates, args=(True,), daemon=True).start()

    def _check_updates(self, manual):
        self._update_busy = True
        try:
            info = fetch_update_info()
            st = load_state()
            st["last_update_check"] = time.time()
            save_state(st)
            newer, full = evaluate_update(info)
            if newer and (manual or info["version"] != st.get("skipped_version")):
                self.ui.put(("update_result", ("available", info, full, manual)))
            elif manual:
                self.ui.put(("update_result", ("current", info, False, True)))
            logging.info("update check: installed %s, site %s, newer=%s, full=%s", APP_VERSION, info.get("version"), newer, full)
        except Exception as e:
            logging.warning("update check failed: %s", e)
            if manual:
                self.ui.put(("update_result", ("error", str(e), False, True)))
        finally:
            self._update_busy = False

    def _show_update_result(self, kind, info, full, manual):
        import tkinter as tk
        from tkinter import ttk
        if getattr(self, "_upd_win", None) and self._upd_win.winfo_exists():
            self._upd_win.destroy()
        w = tk.Toplevel(self.widget.root)
        w.title("עדכונים - הכתבה קולית HGJ")
        w.attributes("-topmost", True)
        w.resizable(False, False)
        self._upd_win = w
        f = ttk.Frame(w, padding=18)
        f.pack(fill="both", expand=True)
        if kind == "current":
            msg = f"אתם בגרסה העדכנית ({APP_VERSION})."
        elif kind == "error":
            msg = "לא ניתן לבדוק עדכונים כרגע (אין חיבור לאתר הכלים).\n" + str(info)
        else:
            what = ("העדכון הזה כולל סביבת פייתון חדשה ודורש הרצת המתקין מדף ההורדה."
                    if full else "העדכון מחליף את קובץ הקוד בלבד (בלי מתקין, בלי הרשאות), ומפעיל את הכלי מחדש. כמה שניות.")
            msg = f"גרסה {info['version']} זמינה (מותקנת: {APP_VERSION}).\n\n{info.get('notes', '')}\n\n{what}"
        ttk.Label(f, text=msg, justify="right", anchor="e", wraplength=460).pack(fill="x")
        btns = ttk.Frame(f)
        btns.pack(fill="x", pady=(16, 0))
        if kind == "available":
            if full:
                ttk.Button(btns, text="פתיחת דף ההורדה", command=lambda: (os.startfile(info["page"] if str(info.get("page", "")).startswith("https://hgj-tools.github.io/") else UPDATE_PAGE), w.destroy())).pack(side="right")
            else:
                ttk.Button(btns, text="עדכון עכשיו", command=lambda: (w.destroy(), self._apply_update(info))).pack(side="right")
            ttk.Button(btns, text="לא עכשיו", command=w.destroy).pack(side="right", padx=(0, 8))
            if not manual:
                def skip():
                    st = load_state(); st["skipped_version"] = info["version"]; save_state(st); w.destroy()
                ttk.Button(btns, text="לדלג על גרסה זו", command=skip).pack(side="left")
        else:
            ttk.Button(btns, text="סגירה", command=w.destroy).pack(side="right")
        w.update_idletasks()
        sw, sh = w.winfo_screenwidth(), w.winfo_screenheight()
        w.geometry(f"+{sw // 2 - w.winfo_width() // 2}+{sh // 2 - w.winfo_height() // 2}")

    def _apply_update(self, info):
        if self.recorder.running:
            self.recorder.stop(cancel=True)
        opts = {"title": "עדכון הכתבה קולית HGJ"}
        self.ui.put(("progress", (5, f"מעדכן לגרסה {info['version']}...", opts)))

        def job():
            try:
                replaced = apply_code_update(info, lambda pct, msg: self.ui.put(("progress", (pct, msg, opts))))
                self.ui.put(("update_apply_done", ("ok", replaced, info)))
            except Exception as e:
                logging.exception("update failed")
                self.ui.put(("update_apply_done", ("error", str(e), info)))
        threading.Thread(target=job, daemon=True).start()

    def _finish_update(self, payload):
        """הקבצים הוחלפו. משחררים את המנעול, מפעילים את הגרסה החדשה ומשגיחים עליה 8 שניות:
        אם היא נופלת, מחזירים את הגיבוי ומדווחים. אם היא חיה, המופע הישן נסגר."""
        import subprocess
        status, data, info = payload
        self.ui.put(("progress", None))
        if status != "ok":
            self.ui.put(("error_msg", f"העדכון לא הושלם, הגרסה הנוכחית נשארה כפי שהיא.\n{data}"))
            return
        replaced = data
        try:
            import keyboard
            keyboard.unhook_all()
        except Exception:
            pass
        kernel32.CloseHandle(self._mutex)
        self._mutex = None
        self.widget.root.withdraw()
        self.widget.overlay_hide()
        self.widget.panel_hide()
        child = subprocess.Popen([sys.executable, os.path.join(HERE, "dictate.py"), "--after-update", APP_VERSION],
                                 cwd=HERE, close_fds=True)
        logging.info("update to %s applied (%s), child pid %s", info.get("version"), ", ".join(replaced), child.pid)

        def watch(n=0):
            rc = child.poll()
            if rc is None and n < 16:
                self.widget.root.after(500, lambda: watch(n + 1))
                return
            if rc is None or rc == 0:
                self.quit()                      # הגרסה החדשה רצה, הישנה נסגרת
                return
            logging.error("updated version exited with %s, rolling back", rc)
            rollback_code_update(replaced)
            self._mutex = kernel32.CreateMutexW(None, False, "HGJ-Dictation-Desktop-Mutex")
            self.widget.root.deiconify()
            import tkinter.messagebox as mb
            mb.showerror("הכתבה קולית", "הגרסה החדשה לא עלתה. הגיבוי הוחזר והגרסה הקודמת ממשיכה לעבוד.\nנסו שוב מאוחר יותר או הורידו את המתקין מדף הכלי.")
        self.widget.root.after(500, watch)


# ----------------------------- מצבי בדיקה בלי ממשק -----------------------------
def test_wav(path):
    import wave
    sys.stdout.reconfigure(encoding="utf-8")
    cfg = load_config()
    with wave.open(path, "rb") as w:
        assert w.getframerate() == SAMPLE_RATE and w.getnchannels() == 1, "נדרש WAV מונו 16kHz"
        audio = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768.0
    tr = Transcriber(cfg)
    t = time.time(); tr.load(); t_load = time.time() - t
    t = time.time(); text = tr.transcribe(audio); t_tr = time.time() - t
    print(f"model load: {t_load:.1f}s | audio: {len(audio)/SAMPLE_RATE:.1f}s | transcribe: {t_tr:.2f}s")
    print("TEXT:", text)


def test_mic(seconds=6):
    """מדפיס את רשימת המיקרופונים ומודד את עוצמת הקול הנקלטת, כדי לכוונן רגישות."""
    import sounddevice as sd
    sys.stdout.reconfigure(encoding="utf-8")
    cfg = load_config()
    dev = Recorder.resolve_device(cfg)
    print("input_device in config:", cfg.get("input_device"), "-> resolved:", dev if dev is not None else "Windows default")
    try:
        print("default input:", sd.query_devices(kind="input")["name"])
    except Exception as e:
        print("default input: (none)", e)
    for i, d in enumerate(sd.query_devices()):
        if d["max_input_channels"] > 0:
            print(f"  [{i}] {d['name']}  (api: {sd.query_hostapis(d['hostapi'])['name']})")
    print(f"recording {seconds}s... speak normally")
    x = sd.rec(int(seconds * SAMPLE_RATE), samplerate=SAMPLE_RATE, channels=1, dtype="float32", device=dev)
    sd.wait()
    blocks = x[:, 0][: (len(x) // BLOCK) * BLOCK].reshape(-1, BLOCK)
    rms = np.sqrt((blocks ** 2).mean(axis=1))
    n = (len(rms) // 10) * 10
    per_half_second = rms[:n].reshape(-1, 10).mean(axis=1) if n >= 10 else rms
    print("rms per 0.5s:", " ".join(f"{v:.4f}" for v in per_half_second))
    floor = float(np.percentile(rms, 20))
    thr = max(cfg["min_energy_threshold"], floor * cfg["noise_multiplier"])
    print(f"noise floor ~{floor:.5f} | peak {rms.max():.5f} | current threshold {thr:.5f}")
    if rms.max() < 0.002:
        print("VERDICT: almost no signal. Wrong device or muted microphone.")
    elif rms.max() < thr:
        print("VERDICT: speech is below the detection threshold. Lower min_energy_threshold in config.json.")
    else:
        print("VERDICT: level OK for detection.")


def transcribe_file_cli(path):
    """תמלול קובץ מהשורה: python dictate.py --transcribe-file הקלטה.m4a"""
    sys.stdout.reconfigure(encoding="utf-8")
    cfg = load_config()
    tr = Transcriber(cfg)
    t = time.time(); tr.load(); print(f"model loaded in {time.time() - t:.1f}s")
    t = time.time()
    lines, total = tr.transcribe_file(path, lambda pct: print(f"\r  {pct:3d}%", end="", flush=True))
    out = write_transcript(path, lines, total)
    print(f"\n{fmt_ts(total)} of audio transcribed in {time.time() - t:.0f}s, {len(lines)} segments")
    print("TRANSCRIPT:", out)


def check_install():
    """בדיקה עצמית של ההתקנה, בלי מיקרופון ובלי מודל: נתיבים, מודולים, Tk. לתמיכה ולבנייה."""
    sys.stdout.reconfigure(encoding="utf-8")
    ok = True
    print("version:", APP_VERSION)
    print("python:", sys.executable)
    print("app dir:", HERE)
    cfg = load_config()
    print("config:", "OK")
    print("model dir:", cfg["model_dir"], "| model.bin present:", os.path.exists(os.path.join(cfg["model_dir"], "model.bin")))
    for mod in ("download_model", "tkinter", "faster_whisper", "ctranslate2", "sounddevice", "keyboard", "pyperclip", "numpy"):
        try:
            __import__(mod)
            print(f"import {mod}: OK")
        except Exception as e:
            ok = False
            print(f"import {mod}: FAILED ({e})")
    try:
        import urllib.request, ssl
        ssl.create_default_context()
        print("update client (urllib+ssl): OK | runtime id:", installed_runtime_id())
    except Exception as e:
        ok = False
        print("update client: FAILED", e)
    try:
        import tkinter
        r = tkinter.Tk(); r.withdraw(); r.destroy()
        print("tk window: OK")
    except Exception as e:
        ok = False
        print("tk window: FAILED", e)
    print("CHECK", "PASSED" if ok else "FAILED")
    sys.exit(0 if ok else 1)


def test_paste(text):
    """מדביק טקסט לחלון הממוקד אחרי 2 שניות, לבדיקת מסלול ההקלדה."""
    sys.stdout.reconfigure(encoding="utf-8")
    cfg = load_config()
    time.sleep(2)
    Typer(cfg).type_text(text)
    print("pasted")


if __name__ == "__main__":
    if len(sys.argv) >= 3 and sys.argv[1] == "--test-wav":
        test_wav(sys.argv[2])
    elif len(sys.argv) >= 3 and sys.argv[1] == "--test-paste":
        test_paste(sys.argv[2])
    elif len(sys.argv) >= 2 and sys.argv[1] == "--test-mic":
        test_mic(int(sys.argv[2]) if len(sys.argv) >= 3 else 6)
    elif len(sys.argv) >= 3 and sys.argv[1] == "--transcribe-file":
        transcribe_file_cli(sys.argv[2])
    elif len(sys.argv) >= 2 and sys.argv[1] == "--demo":
        App().demo()
    elif len(sys.argv) >= 2 and sys.argv[1] == "--check":
        check_install()
    elif len(sys.argv) >= 2 and sys.argv[1] == "--after-update":
        # המופע הישן שחרר את המנעול והוא משגיח עלינו כמה שניות. מתחילים כרגיל ומנקים גיבויים.
        app = App()
        logging.info("running after update from %s", sys.argv[2] if len(sys.argv) > 2 else "?")
        def _cleanup():
            for name in UPDATABLE_FILES:
                try:
                    os.remove(os.path.join(HERE, name + ".bak"))
                except OSError:
                    pass
        app.widget.root.after(20000, _cleanup)
        app.run()
    else:
        App().run()
