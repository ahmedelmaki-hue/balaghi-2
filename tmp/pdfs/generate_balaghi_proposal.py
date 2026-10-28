from pathlib import Path
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.pdfgen import canvas
from reportlab.platypus import Paragraph, Table, TableStyle


ROOT = Path(r"C:\Users\Asus\OneDrive\Desktop\Balaghi")
OUTPUT = ROOT / "output" / "pdf" / "Balaghi_Academic_Project_Proposal.pdf"
LOGO = ROOT / "tmp" / "pdfs" / "college_logo.png"
OUTPUT.parent.mkdir(parents=True, exist_ok=True)

PAGE_W, PAGE_H = 612, 792
LEFT, RIGHT = 72, 540
BODY_W = RIGHT - LEFT
BLUE = colors.HexColor("#2464A7")
TABLE_BLUE = colors.HexColor("#3379B7")
LIGHT = colors.HexColor("#F1F1F1")

BODY = ParagraphStyle(
    "body", fontName="Times-Roman", fontSize=11.0, leading=13.0,
    alignment=TA_LEFT, spaceAfter=0,
)
BULLET = ParagraphStyle(
    "bullet", parent=BODY, leftIndent=0, firstLineIndent=0,
)
SMALL = ParagraphStyle(
    "small", fontName="Times-Roman", fontSize=9.0, leading=10.5,
)
TABLE_BODY = ParagraphStyle(
    "table", fontName="Times-Roman", fontSize=8.9, leading=10.6,
)
TABLE_BOLD = ParagraphStyle(
    "tablebold", parent=TABLE_BODY, fontName="Times-Bold",
)
TABLE_HEAD = ParagraphStyle(
    "tablehead", fontName="Times-Bold", fontSize=9, leading=10.5,
    textColor=colors.white, alignment=TA_CENTER,
)


def page_header(c, number):
    if number > 1:
        c.setFillColor(colors.black)
        c.setFont("Times-Roman", 10)
        c.drawCentredString(PAGE_W / 2, 751, "College of Electronic Technology Tripoli")
        c.setStrokeColor(colors.HexColor("#666666"))
        c.setLineWidth(0.65)
        c.line(72, 746, 540, 746)
    c.setFillColor(colors.black)
    c.setFont("Times-Roman", 10)
    c.drawCentredString(PAGE_W / 2, 50, str(number))


def para(c, y, text, *, after=9, style=BODY, x=LEFT, width=BODY_W):
    p = Paragraph(text, style)
    _, h = p.wrap(width, 1000)
    p.drawOn(c, x, y - h)
    return y - h - after


def heading(c, y, text, *, before=8, after=13):
    y -= before
    c.setFillColor(BLUE)
    c.setFont("Times-Roman", 16)
    c.drawString(LEFT, y - 15, text)
    c.setFillColor(colors.black)
    return y - 15 - after


def subheading(c, y, text, *, before=5, after=9, blue=False):
    y -= before
    c.setFillColor(BLUE if blue else colors.black)
    c.setFont("Times-Roman" if blue else "Times-Bold", 12 if blue else 11.2)
    c.drawString(LEFT, y - 12, text)
    c.setFillColor(colors.black)
    return y - 12 - after


def bullet(c, y, text, *, after=3):
    c.setFillColor(colors.black)
    c.circle(91, y - 6, 2.4, fill=1, stroke=0)
    return para(c, y, text, after=after, style=BULLET, x=108, width=432)


def end_page(c, number, y):
    if y < 70:
        raise RuntimeError(f"Page {number} content is too low: {y:.1f}")
    page_header(c, number)
    c.showPage()


def draw_table(c, y, columns, rows, widths, *, font=TABLE_BODY, padding=5, vertical_padding=4):
    cells = [[Paragraph(escape(v), TABLE_HEAD) for v in columns]]
    for row in rows:
        cells.append([
            Paragraph(str(value), TABLE_BOLD if index == 0 else font)
            for index, value in enumerate(row)
        ])
    table = Table(cells, colWidths=widths, hAlign="LEFT")
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), TABLE_BLUE),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, LIGHT]),
        ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#BABABA")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), padding),
        ("RIGHTPADDING", (0, 0), (-1, -1), padding),
        ("TOPPADDING", (0, 0), (-1, -1), vertical_padding),
        ("BOTTOMPADDING", (0, 0), (-1, -1), vertical_padding),
    ]))
    _, h = table.wrap(BODY_W, 1000)
    table.drawOn(c, LEFT, y - h)
    return y - h - 10


c = canvas.Canvas(str(OUTPUT), pagesize=(PAGE_W, PAGE_H))
c.setTitle("Balaghi - Academic Project Proposal")
c.setAuthor("Balaghi project team")

# Cover: same framed college mark and centred academic hierarchy as the source.
c.setStrokeColor(colors.HexColor("#777777"))
c.setLineWidth(0.8)
c.rect(58, 100, 496, 594, fill=0, stroke=1)
c.drawImage(ImageReader(str(LOGO)), 73, 568, width=466, height=117, mask="auto")
c.setStrokeColor(colors.black)
c.setLineWidth(0.7)
c.line(88, 530, 524, 530)
c.setFillColor(colors.black)
c.setFont("Times-Bold", 16)
for y, line in [
    (492, "Balaghi: A Mobile Application for Civic Issue Reporting"),
    (464, "with a Web-Based Dashboard for Report Management"),
]:
    c.drawCentredString(306, y, line)
c.setFont("Times-Bold", 13)
c.drawCentredString(306, 426, "Academic Project Proposal")
c.setFont("Times-Roman", 11)
c.drawCentredString(306, 390, "Degree:  Bachelor of Software Engineering")
c.drawCentredString(306, 370, "Date:  September 27, 2026")
c.setFont("Times-Roman", 15)
c.drawCentredString(306, 331, "Prepared by:")
c.setFont("Times-Roman", 14)
c.drawCentredString(306, 304, "Ahmed Louay Al-Makki")
c.drawCentredString(306, 280, "Ali Maatouq Ghumaid")
c.drawCentredString(306, 256, "Mahmoud Ali Al-Hussein")
c.setFont("Times-Roman", 15)
c.drawCentredString(306, 216, "Supervised by:")
page_header(c, 1)
c.showPage()

# Page 2: introduction, scope, problem statement.
y = 715
y = heading(c, y, "1. Introduction", before=0)
y = para(c, y, "Municipal problems such as road potholes, water leaks, and accumulated garbage are often reported through fragmented channels. A useful report must connect a <b>clear image, reliable coordinates, a category, and a traceable status</b> so that the responsible team can assess and act on it.")
y = para(c, y, "<b>Balaghi</b> proposes one accessible route from the citizen's phone to a municipal dashboard. Visitors can explore a public map without signing in; citizens submit and follow reports; staff review requests before public display, record decisions, and update progress. The first release is limited to one municipality and three issue categories.")
y = heading(c, y, "2. Scope Of Work")
y = para(c, y, "The system covers the core lifecycle of a non-emergency civic report through the following modules:", after=6)
for item in [
    "<b>Citizen access:</b> Phone-number OTP sign-in and a short profile step; no citizen email or password.",
    "<b>Report submission:</b> A new photograph captured with the device camera, GPS coordinates or a manually selected point, an issue category, and an optional description. Gallery selection is unavailable.",
    "<b>Public map:</b> Municipality-reviewed reports, with location markers, category filters, status colours, and public details that exclude reporter identity.",
    "<b>My Reports:</b> A private list of the citizen's submissions and their current states, including a reason when one is rejected.",
    "<b>Municipal dashboard:</b> Admin-issued staff username and password, a review queue for approving or rejecting reports before publication, status updates, and basic statistics.",
    "<b>Data and media:</b> PostgreSQL records, private image storage, and a server API that enforces role-based access.",
]:
    y = bullet(c, y, item)
y = heading(c, y, "3. Problem Statement", before=7)
y = para(c, y, "When reports arrive through calls, messages, or in-person visits, photographs and locations may be missing or separated from the request. Citizens may not know whether the issue was received, while staff lack a single view of requests and their processing history.")
y = para(c, y, "The absence of a shared report identifier makes follow-up difficult. A road defect may be described by different street names, while the precise point is unclear. Separate informal messages also make it hard to distinguish a new problem from a repeated question about an existing one.")
y = para(c, y, "A useful solution must serve two different views: a public view that helps residents see nearby issues, and a restricted view that gives authorised staff the information needed to respond. Combining these views without exposing a reporter's contact details is a central design requirement.", after=0)
end_page(c, 2, y)

# Page 3: objectives and opening literature discussion.
y = 715
y = para(c, y, "Balaghi addresses this gap with a location-based workflow. It aims to make submission simple, make public progress visible, and preserve a private operational record for the municipality. Map labels are helpful context, but a report is anchored by coordinates; GPS accuracy and manual correction must still be checked by the user.", after=14)
y = heading(c, y, "4. Objectives", before=0)
y = para(c, y, "The project has four primary objectives and three supporting objectives that keep the first release feasible for a graduation project.", after=7)
y = subheading(c, y, "4.1 Primary Objectives")
for item in [
    "<b>Simple citizen reporting:</b> Provide an Android flow that captures a new camera photograph, position, category, and optional description in at most four steps, without gallery import.",
    "<b>Transparent public map:</b> Show report locations and states only after municipal review, without exposing the citizen's name, phone, or account identifier.",
    "<b>Controlled municipal workflow:</b> Enable authorised staff to approve or reject reports before public display, record rejection reasons, and track subsequent status changes.",
    "<b>Dependable data service:</b> Store reports, images, and state changes consistently through an API backed by PostgreSQL and Supabase services.",
]:
    y = bullet(c, y, item, after=5)
y = subheading(c, y, "4.2 Secondary Objectives", before=7)
for item in [
    "<b>Weak-network resilience:</b> Keep an unsent report locally and retry it with the same request identifier when connectivity returns.",
    "<b>Usability:</b> Keep the Arabic citizen interface clear, with manual map placement when automatic location is unavailable or inaccurate.",
    "<b>Evaluation:</b> Test the main user journeys, access rules, and map-query performance using a documented demonstration dataset.",
]:
    y = bullet(c, y, item, after=5)
y = heading(c, y, "5. Literature Review", before=7)
y = subheading(c, y, "5.1 Civic Service Requests", blue=True, after=7)
y = para(c, y, "Open311 GeoReport v2 describes a common way to submit and track location-based, non-emergency issues such as potholes and street cleaning [1]. It informs Balaghi's separation of service categories, requests, and statuses, without requiring the prototype to claim full Open311 compatibility.", after=0)
end_page(c, 3, y)

# Page 4: literature, methodology, technology heading.
y = 715
y = para(c, y, "Citizen-generated geographic information can improve the visibility of local conditions, while also requiring attention to data quality and review. Goodchild's discussion of volunteers as geographic observers provides a useful conceptual basis for the citizen contribution model [2].", after=12)
y = subheading(c, y, "5.2 Open Mapping and Location", blue=True)
y = para(c, y, "OpenStreetMap supplies a map background, but street-name data may differ from local usage. Balaghi therefore stores latitude and longitude separately from any displayed address, allows a user to move a marker, and treats the address as descriptive text. Map attribution and the chosen tile provider's usage policy remain part of deployment requirements [3, 4].", after=12)
y = subheading(c, y, "5.3 Authentication and Privacy", blue=True)
y = para(c, y, "Supabase Auth supports phone-based one-time passwords, while PostgreSQL access rules and server-side checks can limit who sees each record [5, 6]. The OWASP mobile security standard highlights secure storage, authentication, network protection, and privacy controls [7]. Balaghi applies these ideas by keeping reporter identity out of public endpoints and storing sensitive keys only on the server.", after=12)
y = heading(c, y, "6. Project Methodology", before=5)
y = para(c, y, "A hybrid staged-and-iterative process suits the project. Requirements, data design, and access rules come first; short implementation cycles then deliver demonstrable slices: a public map, citizen login, report submission, private report tracking, and the staff dashboard.")
y = para(c, y, "Each cycle ends with a working build and targeted tests. The team will validate phone OTP with development test numbers before using a real SMS provider, then check the route from citizen submission through staff review to public display and status updates. Authentication, data visibility, camera capture, and the weak-network retry path receive explicit test cases.")
y = para(c, y, "A submitted report is visible to its author and authorised staff while awaiting review. Staff may approve it for the public map or reject it with a recorded reason. Approval controls visibility; it does not mean that repair work has started. Public statuses remain new, in progress, and resolved.")
y = para(c, y, "The first release deliberately excludes live notifications, public comments or voting, automatic image classification, multiple municipalities, and a full iOS release. This controls scope while preserving the essential reporting and follow-up workflow.", after=10)
y = para(c, y, "Evaluation will use practical acceptance criteria: a complete report in no more than four steps; camera-only capture; correct access for visitors, citizens, and staff; pre-publication review; a recorded status history; and a measured response time for a 500-marker map batch in a stated test environment. Tests will also cover an incorrect OTP, denied location permission, duplicate retry, and report rejection.")
y = para(c, y, "The external dependencies with the greatest uncertainty are real SMS delivery to Libyan numbers and map-label quality. The prototype will keep a documented test-number path, and the report form will let the citizen adjust the map pin when the automatic location or street label is unsuitable.", after=10)
end_page(c, 4, y)

# Page 5: technology matrix.
y = 716
y = heading(c, y, "7. Technologies", before=0, after=12)
tech_rows = [
    ("Mobile", "Flutter / Dart", "Android citizen application and Arabic user interface"),
    ("Mobile", "flutter_map / MapLibre", "Interactive public map and report markers"),
    ("Mobile", "Geolocator", "Device coordinates with permission handling"),
    ("Mobile", "Secure storage", "Local protection for citizen session tokens"),
    ("Mobile", "HTTP client", "Requests to the Balaghi API"),
    ("Backend", "Node.js / Express", "HTTP API and municipal business rules"),
    ("Backend", "PostgreSQL", "Profiles, reports, and status-history records"),
    ("Backend", "Supabase Auth", "Citizen OTP and staff account authentication"),
    ("Backend", "Supabase Storage", "Private report photographs and short-lived access links"),
    ("Backend", "Sharp", "Image processing and metadata removal"),
    ("Backend", "Multer", "Multipart image upload handling"),
    ("Backend", "Supabase JS", "Server-side authentication and storage integration"),
    ("Dashboard", "React / TypeScript", "Planned staff review interface"),
    ("Mapping", "OpenStreetMap data", "Street-map context with visible attribution"),
    ("Mapping", "OpenFreeMap", "Map style and hosted tile delivery"),
    ("Testing", "Flutter / Node tests", "Mobile flow and API behaviour checks"),
    ("Tools", "VS Code / Git", "Development, version control, and project documentation"),
]
y = draw_table(c, y, ["Layer", "Technology", "Role"], tech_rows, [90, 135, 243], padding=5, vertical_padding=6)
end_page(c, 5, y)

# Page 6: complete timeline, outcomes, conclusion.
y = 715
y = heading(c, y, "8. Project Timeline", before=0, after=8)
y = para(c, y, "A proposed 22-week plan follows the eight-phase structure of the project. If external SMS setup is delayed, development test numbers keep the authentication flow demonstrable while provider evaluation continues.", after=13)
timeline_rows = [
    ("1  Research &amp; Design", "1-3", "Requirements, interface design, data model, and references", "Approved proposal and system design"),
    ("2  Core Backend", "4-7", "Database, roles, OTP routes, report API, private images", "API and database demonstration"),
    ("3  Citizen App", "8-10", "Onboarding, phone login, profile, public map", "Working Android navigation"),
    ("4  Reporting", "11-13", "Image, GPS/manual point, categories, private list", "End-to-end citizen report"),
    ("5  Staff Dashboard", "14-16", "Login, pre-publication review, rejection reasons, status changes", "Municipal workflow demo"),
    ("6  Reliability", "17-19", "Retry queue, access rules, image checks, usability fixes", "Resilient integrated build"),
    ("7  Testing &amp; Docs", "20-21", "Role tests, performance checks, API and user guide", "Documented test results"),
    ("8  Defense Prep", "22", "APK, slides, dataset, and rehearsal", "Defense-ready submission"),
]
y = draw_table(c, y, ["Phase", "Weeks", "Key activities", "Milestone"], timeline_rows, [91, 42, 190, 145], padding=4)
y = heading(c, y, "9. Expected Outcomes", before=6, after=7)
y = para(c, y, "The project is expected to deliver a testable civic reporting prototype and evidence of its main workflows:", after=5)
for item in [
    "<b>An Android citizen application</b> for camera-and-location reports, viewing reviewed reports on a public map, and personal report tracking.",
    "<b>A municipal dashboard</b> for authorised staff to review reports before publication, record decisions, change status, and view basic counts.",
    "<b>A documented service</b> with controlled access, report history, private media handling, and a repeatable demonstration dataset.",
]:
    y = bullet(c, y, item, after=3)
y = heading(c, y, "10. Conclusion", before=7, after=7)
y = para(c, y, "Balaghi turns scattered descriptions of civic problems into structured, location-based requests that a municipality can inspect before making them public. The design joins a simple citizen flow with a reviewed public map and a private staff workflow, while keeping the reporter's identity outside public responses.")
y = para(c, y, "The proposed Flutter, Express, PostgreSQL, and Supabase stack supports a focused first release for one municipality. Success will be judged by whether a citizen can submit a complete report, staff can move it through a recorded status process, and both sides can see the appropriate view of progress.", after=9)
y = para(c, y, "The final demonstration will also show the limits of the prototype openly: SMS delivery depends on the configured provider, map labels may require local correction, and the system does not replace emergency-response channels. These boundaries keep the project measurable and honest while leaving a clear route for future expansion.", after=0)
end_page(c, 6, y)

# Page 7: references retained as a separate numbered section.
y = 715
y = heading(c, y, "11. References", before=0, after=10)
refs = [
    "Open311. (n.d.). <i>GeoReport v2 specification.</i> wiki.open311.org/GeoReport_v2/",
    "Goodchild, M. F. (2007). Citizens as sensors: The world of volunteered geography. <i>GeoJournal, 69</i>, 211-221. doi:10.1007/s10708-007-9111-y",
    "OpenStreetMap Foundation. (n.d.). <i>Copyright and license.</i> openstreetmap.org/copyright",
    "OpenStreetMap Foundation. (n.d.). <i>Tile usage policy.</i> operations.osmfoundation.org/policies/tiles/",
    "Supabase. (n.d.). <i>Phone sign-in.</i> supabase.com/docs/guides/auth/phone-login",
    "Supabase. (n.d.). <i>Row Level Security.</i> supabase.com/docs/guides/database/postgres/row-level-security",
    "OWASP. (n.d.). <i>Mobile Application Security Verification Standard.</i> mas.owasp.org/MASVS/",
    "Flutter. (n.d.). <i>Build and release an Android app.</i> docs.flutter.dev/deployment/android",
    "PostgreSQL Global Development Group. (n.d.). <i>PostgreSQL documentation.</i> postgresql.org/docs/",
    "Express. (n.d.). <i>Express web framework documentation.</i> expressjs.com/",
    "Supabase. (n.d.). <i>Storage documentation.</i> supabase.com/docs/guides/storage",
    "Baseflow. (n.d.). <i>Geolocator package documentation.</i> pub.dev/packages/geolocator",
    "Node.js. (n.d.). <i>Node.js learning resources.</i> nodejs.org/learn",
    "OpenFreeMap. (n.d.). <i>OpenFreeMap documentation.</i> openfreemap.org/",
]
for index, reference in enumerate(refs, 1):
    c.setFont("Times-Roman", 10)
    c.setFillColor(colors.black)
    c.drawRightString(95, y - 9, f"{index}.")
    y = para(c, y, reference, x=108, width=432, style=SMALL, after=11)
end_page(c, 7, y)

c.save()
print(OUTPUT)
