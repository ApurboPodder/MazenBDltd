EYEWEAR HOME, PROJECT GALLERY, AND CONFIGURATOR

Open index.html for the home page, gallery.html to browse the project
collection, image-converter.html to remove image backgrounds or batch-convert
images to WebP,
configurator.html for a single eyewear model, or multi-configurator.html to
compare multiple models in one viewer. The home page includes a live 3D
Modern Design preview. Project pages display product photos, which can be
selected to open the full-screen image gallery.

CONFIGURATOR MODEL VIEWER

Choose a self-contained GLB file or drop it into the configurator viewer. Model
files are read locally in your browser and are not uploaded. The bundled face
model can be shown or hidden with the Show face option. The viewer supports
orbit, pan, zoom, standard views, fit, reset, and auto-rotation.
GLB files larger than 70 MB and formats that need external companion files
are not supported. The viewer loads Three.js from jsDelivr, so an internet
connection is required to initialize the 3D preview.

The multi-model configurator accepts multiple GLB files at once through its
file picker or drag and drop. Each added model has an independent visibility
switch and can be removed without affecting other objects in the scene.
Both configurators provide X, Y, and Z sliders and numeric inputs for
positioning the bundled face model relative to the eyewear. Eyewear models can
also be rotated on all three axes; the multi-model page provides separate
rotation controls for every object. Changing model position or rotation and
toggling face variants preserves the current camera view; use Fit to reframe.
Model rotation is

Project 6 is listed in project-data.json and uses the photos and two GLB models
in assets/gallery-covers/Project 6/. Open its configurator from the project
detail page. The Show face switch selects GLB 1 with the face visible and GLB 2
with the face hidden. Model rotation is
adjustable independently on all three axes; the multi-model page has a
separate rotation control for each object.

PROJECT CARDS

The Classic Acetate, Fashion Acetate, Rounded Metal Design, and Project 4
gallery cards open image-based project detail pages. Modern Design uses the
five WebP product views in assets/gallery-covers/project 5/ and opens its GLB
model in the configurator. Rounded Metal Design uses the five WebP images in
assets/gallery-covers/project 3/; Project 4 uses the four WebP images in
assets/gallery-covers/project 4/. Open a project image full screen to zoom
with the mouse wheel or a two-finger pinch; drag to pan while zoomed.

IMAGE BACKGROUND REMOVER AND CONVERTER

Open image-converter.html to remove image backgrounds onto pure white or
convert multiple images. Background removal uses the full-precision IS-Net AI
model and keeps a hard-edged, editable mask. The mask editor lets you erase
missed background (including clear eyeglass lenses) or restore original pixels
with a brush. It does not feather, smooth, or resize the foreground. Choose a
white or transparent background and export JPEG, PNG, or WebP; JPEG always uses
a white background, and PNG is lossless. Add files with the picker or drag and
drop, adjust lossy output quality, and download images individually or together
in a ZIP archive. Image processing stays in the browser. Background removal
loads the IMG.LY AI library and model from public CDNs on first use (about
80 MB); an internet connection is required, but the selected images are not
uploaded. The library is AGPL-licensed; review its license before deploying
this site. Animated images use their first frame, and image support depends on
the browser. Standard ZIP archives are limited to 65,535 files and 4 GB.

VIRTUAL TRY-ON

On a project page with a GLB model, choose Try on with camera to align the
eyewear over a live face-tracked smartphone camera preview. The preview is
processed locally and is not recorded or uploaded. Camera access requires
HTTPS or localhost and user permission; browsers may block camera access on a
local-network HTTP address. The page uses MediaPipe Face Landmarker and
Three.js from their public CDNs, so an internet connection is required.
The frame follows the detected eye line and full 3D face orientation; a
depth-only face mesh hides frame parts that pass behind the face as you turn.
Adjust frame size and X, Y, or Z position in the try-on controls if needed.
Position offsets are relative to the distance between the eyes; positive X
moves right, positive Y moves up, and positive Z moves toward the camera. The
try-on aligns the model's frontmost frame plane with the tracked face and keeps
a forward clearance to avoid the glasses sinking into the face.

Projects added through admin.html can be saved directly into a local website folder
or local GitHub repository clone, or uploaded to Vercel Blob from the deployed
site. For GitHub Pages, run the site from localhost or HTTPS, open admin.html in
Chrome or Edge, choose the repository root containing project-data.json and
assets, and save the project. Then commit and push project-data.json and the
new assets/gallery-covers/<project-id>/ folder to the publishing branch (main by
default). The included GitHub Actions workflow deploys the update. The browser
saves to your local repository; it does not push commits. For Vercel uploads,
create and connect a public Blob store to the project, then add a strong
PROJECT_UPLOAD_PASSWORD environment variable in Vercel for Production and
Preview and redeploy. Open the deployed admin.html and enter that password to
publish. Never put the password or the Blob read-write token in website files.

Provide a project name and one or more browser-supported image files; they
are converted to WebP automatically (up to 10 MB per converted image). GLB
models (up to 70 MB each) are optional. The first naturally sorted image
becomes the cover, and all images appear on the project detail page. GLBs are
paired in alphabetical order: the first is the main model and the second is
used by the face toggle. Local project files are saved under
assets/gallery-covers/<project-id>/ and registered in project-data.json.
Vercel projects and their public media are stored in Blob and remain available
across site redeployments. Refresh the gallery after saving.
On every GitHub Pages deployment, the workflow also scans
assets/gallery-covers/ for new project folders containing WebP images. It
creates a card using the folder name as the title, the first naturally sorted
WebP image as the cover, and all WebP images as project photos. VS Code Live
Server also discovers new folders when its directory listing is enabled.
If a folder contains GLB files, the first alphabetically sorted GLB is linked from
the project detail page to the configurator. If the folder contains more than
one GLB, the Show face checkbox switches to the second alphabetically sorted GLB
and shows the shared face model while checked. Existing folders already listed
in project-data.json are not added again. Commit the new folder to the
publishing branch to trigger the GitHub Pages scan and deployment.
Use the theme button to switch between light and dark modes. The selection is
shared by the site pages and remembered in the current browser.

INSTALLABLE WEB APP

The website can be installed as an app when served over HTTPS (including GitHub
Pages) or localhost. Open the site in a supported browser and choose its Install
app option; on iPhone or iPad, use Safari Share > Add to Home Screen. The service
worker caches the app pages and project list for repeat visits and offline
access. Large GLB models and features that load external libraries or AI models
still need an internet connection.

PUBLISHING WITH GITHUB PAGES

1. Push this complete site to a GitHub repository. The included Pages workflow
   publishes commits on the main branch. If you use a different branch, edit
   .github/workflows/pages.yml to match it.
2. In the repository, open Settings > Pages and set the build and deployment
   source to GitHub Actions.
3. Add or edit projects locally with admin.html, then commit and push the
   updated project-data.json and assets/gallery-covers/ files to deploy them.

PUBLISHING WITH VERCEL

1. Import this repository into Vercel and use the repository root as the Root
   Directory. The included vercel.json runs the project-folder scan before each
   deployment and serves the site from the repository root.
2. In the Vercel dashboard, create a public Blob store and connect it to the
   project for Production and Preview. Add PROJECT_UPLOAD_PASSWORD as an
   environment variable in those environments, then deploy again.
3. On each deployment, new folders under
   assets/gallery-covers/ that contain WebP images are added to
   project-data.json automatically, including their photos and any GLB models.
   Existing projects are not duplicated.
4. To publish from the website, open the deployed admin.html, enter
   PROJECT_UPLOAD_PASSWORD, and submit the project images and optional GLB
   models. These uploads are saved to Blob and appear in the gallery without a
   code change or redeployment. Alternatively, add files under
   assets/gallery-covers/ and push them to the connected branch for build-time
   discovery.

LOCAL PREVIEW

Open index.html to browse the static pages directly. Browser security prevents
project GLB files from loading from file:// URLs; use a web host to preview
bundled project models. User-selected GLB files can still be opened directly
in the configurator.
