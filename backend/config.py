import os
from dotenv import load_dotenv

load_dotenv()

# ============================================================
# Azure AD Configuration
# ============================================================
CLIENT_ID  = os.getenv("AZURE_CLIENT_ID",  "ac4edccf-a8ee-41aa-bcc4-6603c4bebae1")
TENANT_ID  = os.getenv("AZURE_TENANT_ID",  "5983a1d2-f46b-492d-a9b3-7e2f3609d20b")
AUTHORITY  = f"https://login.microsoftonline.com/{TENANT_ID}"
GRAPH_SCOPES = ["Files.ReadWrite"]

# ============================================================
# Base OneDrive share link (ROOT folder)
# ============================================================
BASE_SHARE_LINK = os.getenv(
    "BASE_SHARE_LINK",
    "https://aeondelight-my.sharepoint.com/:f:/g/personal/dung_ho_aeondelight_biz/IgBc94E-94OYSJrcBeW25Qr1AYGgQpCmZLkb_7kwFWE01_4?e=qV4Vj5"
)

# ============================================================
# OneDrive subfolder paths (relative from ROOT)
# ============================================================
# FOR AEONMALL
NVL_REPORT_FORM_PATH   = "REPORT FORM/NVL REPORT FORM"
TQB_REPORT_FORM_PATH   = "REPORT FORM/TQB REPORT FORM"
BDNC_REPORT_FORM_PATH  = "REPORT FORM/BDNC REPORT FORM"
VG_REPORT_FORM_PATH    = "REPORT FORM/VG REPORT FORM"
MDR_REPORT_FORM_PATH   = "REPORT FORM/MDR REPORT FORM"

# FOR MAXVALUE
LACASTA_REPORT_FORM_PATH = "REPORT FORM/MAXVALUE/LACASTA"

# HOTLINES & CONFIRM FORM
HOTLINES_AND_CONFIRM_FORM_PATH = "HOTLINE_AND_CONFIRM_FORM"

# DAVITEQ IMAGE ARCHIVE
GATEWAY_BDNC_PATH = "DAVITEQ/IMAGE_ ARCHIVE/GATEWAY/BDNC"
GATEWAY_TQB_PATH  = "DAVITEQ/IMAGE_ ARCHIVE/GATEWAY/TQB"
GATEWAY_NVL_PATH  = "DAVITEQ/IMAGE_ ARCHIVE/GATEWAY/NVL"
GATEWAY_VG_PATH   = ""  # PENDING

LAYOUT_BDNC_PATH  = "DAVITEQ/IMAGE_ ARCHIVE/LAYOUT/BDNC"
LAYOUT_TQB_PATH   = "DAVITEQ/IMAGE_ ARCHIVE/LAYOUT/TQB"
LAYOUT_NVL_PATH   = "DAVITEQ/IMAGE_ ARCHIVE/LAYOUT/NVL"
LAYOUT_VG_PATH    = "DAVITEQ/IMAGE_ ARCHIVE/LAYOUT/VG"

SENSOR_BDNC_PATH  = "DAVITEQ/IMAGE_ ARCHIVE/SENSOR/BDNC"
SENSOR_TQB_PATH   = "DAVITEQ/IMAGE_ ARCHIVE/SENSOR/TQB"
SENSOR_NVL_PATH   = "DAVITEQ/IMAGE_ ARCHIVE/SENSOR/NVL"
SENSOR_VG_PATH    = ""  # PENDING

AL_NVL_PATH       = "DAVITEQ/IMAGE_ ARCHIVE/ALARM POINTS/NVL"
AL_TQB_PATH       = "DAVITEQ/IMAGE_ ARCHIVE/ALARM POINTS/TQB"
AL_BDNC_PATH      = ""  # NOT AVAILABLE
AL_VG_PATH        = "DAVITEQ/IMAGE_ ARCHIVE/ALARM POINTS/VG"

# DOCUMENTARY
DOCUMENTARY_PATH = "DOCUMENTARY"

# ============================================================
# Local storage directories
# ============================================================
BASE_DIR = os.getenv("RMC_BASE_DIR", r"D:\RMC_Assistant_ver1.1")

CACHE_DIR              = os.path.join(BASE_DIR, "Cache")
CACHE_FILE             = os.path.join(CACHE_DIR, "token_cache.bin")
REPORT_FORM_DIR        = os.path.join(BASE_DIR, "Report_Form_Cache")
NOTE_ARCHIVE_DIR       = os.path.join(BASE_DIR, "NOTE")
IMAGE_LAYOUT_DIR       = os.path.join(BASE_DIR, "IMAGE", "LAYOUT")
IMAGE_GATEWAY_DIR      = os.path.join(BASE_DIR, "IMAGE", "GATEWAY")
IMAGE_SENSOR_DIR       = os.path.join(BASE_DIR, "IMAGE", "SENSOR")
IMAGE_AL_DIR           = os.path.join(BASE_DIR, "IMAGE", "ALARMPOINT")
DOCUMENTARY_ARCHIVE_DIR = os.path.join(BASE_DIR, "DOCUMENTARY")
METADATA_DIR           = os.path.join(BASE_DIR, "METADATA")
METADATA_FILE          = os.path.join(METADATA_DIR, "onedrive_metadata.json")

# Image category → local dir mapping
IMAGE_CATEGORY_DIR = {
    "LAYOUT":     IMAGE_LAYOUT_DIR,
    "GATEWAY":    IMAGE_GATEWAY_DIR,
    "SENSOR":     IMAGE_SENSOR_DIR,
    "ALARMPOINT": IMAGE_AL_DIR,
}

# Image category → site → OneDrive path
IMAGE_PATHS = {
    "GATEWAY": {
        "BDNC": GATEWAY_BDNC_PATH,
        "TQB":  GATEWAY_TQB_PATH,
        "NVL":  GATEWAY_NVL_PATH,
    },
    "LAYOUT": {
        "BDNC": LAYOUT_BDNC_PATH,
        "TQB":  LAYOUT_TQB_PATH,
        "NVL":  LAYOUT_NVL_PATH,
        "VG":   LAYOUT_VG_PATH,
    },
    "SENSOR": {
        "BDNC": SENSOR_BDNC_PATH,
        "TQB":  SENSOR_TQB_PATH,
        "NVL":  SENSOR_NVL_PATH,
    },
    "ALARMPOINT": {
        "TQB": AL_TQB_PATH,
        "NVL": AL_NVL_PATH,
        "VG":  AL_VG_PATH,
    },
}

# Sites config: group → list_key → OneDrive path
SITES_CONFIG = {
    "AEONMALL": {
        "ANVL":  NVL_REPORT_FORM_PATH,
        "ATQB":  TQB_REPORT_FORM_PATH,
        "ABDNC": BDNC_REPORT_FORM_PATH,
        "AVG":   VG_REPORT_FORM_PATH,
        "AMDR":  MDR_REPORT_FORM_PATH,
    },
    "MAXVALUE": {
        "LACASTA": LACASTA_REPORT_FORM_PATH,
    },
}

# ============================================================
# Create all local directories on import
# ============================================================
for _dir in [
    CACHE_DIR, REPORT_FORM_DIR, NOTE_ARCHIVE_DIR,
    IMAGE_LAYOUT_DIR, IMAGE_GATEWAY_DIR, IMAGE_SENSOR_DIR, IMAGE_AL_DIR,
    DOCUMENTARY_ARCHIVE_DIR, METADATA_DIR,
]:
    os.makedirs(_dir, exist_ok=True)
