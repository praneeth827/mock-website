# BloodConnect (Static Web App)

A modern, mobile‑friendly website that connects blood seekers with nearby donors. Built with plain HTML, CSS, and JavaScript, using Firebase Authentication and localStorage for persistence with Google Maps for geospatial search.

## Key Features
- **Firebase Authentication**: Email/password, Google, and Facebook login
- **Donor registration and profile management** (edit supported)
- **Seeker dashboard with location‑aware search** (whole district, sorted by distance)
- **Map rendering** with red dot markers for every donor; blue dot for seeker center
- **Overlap handling**: multiple donors at the same location are offset and clickable
- **Multi‑select blood type search** (optional; if none selected, shows all types)
- **Persistent storage** for users/donors/requests in localStorage
- **Session persistence** across refresh/network hiccups
- **Multilingual UI** (English default + తెలుగు, हिन्दी, தமிழ், മലയാളം, ಕನ್ನಡ)
- **Location handling**: manual input or detect location; robust geocoding with Google/OSM fallback
- **India-only filtering**: Only shows donors within Indian state boundaries

## Tech Stack
- HTML5, CSS3, JavaScript (no framework)
- **Firebase Authentication** (email/password, Google, Facebook)
- Google Maps JavaScript API (map + optional geocoder)
- OpenStreetMap Nominatim (fallback geocoding)
- Browser localStorage for data persistence

## Project Structure
```
BloodConnect/
├── .dist/                 # Main application files
│   ├── index.html        # Single-page app UI with Firebase SDK
│   ├── styles.css        # Responsive styles
│   └── script.js         # Application logic with Firebase Auth
├── README.md             # This file
└── .vscode/              # VS Code settings (optional)
    └── settings.json     # Live Server root configuration
```

## Getting Started
1) Open the folder in VS Code.
2) Ensure the Live Server extension is installed.
3) We already set Live Server root to `/.dist`. If needed, confirm in `.vscode/settings.json`:
```
{
  "liveServer.settings.root": "/.dist"
}
```
4) Click "Go Live" or right‑click `.dist/index.html` → "Open with Live Server".

## API Keys Required

### Google Maps API Key
Set the key in `.dist/index.html` (already included):
```html
<script src="https://maps.googleapis.com/maps/api/js?key=YOUR_KEY&callback=initMap&loading=async" async defer></script>
```
Required APIs in Google Cloud Console:
- Maps JavaScript API
- Geocoding API (recommended for best accuracy)
Also enable billing and allow local origins (localhost / 127.0.0.1) if restricting the key.

### Firebase Configuration
Firebase is already configured in `.dist/index.html` with:
- Authentication (email/password, Google, Facebook)
- Project ID: `bloodconnect-990f6`
- Users created through the app will appear in Firebase Console

## Usage
### Sign Up / Sign In
- **Email/Password**: Create account with first name, last name, email, and password
- **Google Sign In**: Direct Google authentication (no additional details page)
- **Facebook Sign In**: Direct Facebook authentication
- Users created through the app appear in Firebase Console
- Existing users with a donor profile land on the Donor Dashboard first

### Donor (Profile & Edit)
- Fill blood type, age, gender, contact, occupation, and location.
- **Government ID Upload**: Upload Aadhaar, PAN, Voter ID, etc. (stored locally)
- **Location options**:
  - Detect Location: GPS → reverse‑geocoded and coordinates saved
  - Manual: enter "village/town/city, district, state". Coordinates resolved automatically.
- **Eligibility Quiz**: Must pass rules & regulations test to create profile
- **Edit Profile**: from donor dashboard, updates persist to localStorage
- **Availability Toggle**: Set Available/Not Available status

### Seeker (Search)
- **Blood types**: multi‑select; if none selected, all types are included.
- **Location**: manual or detect. Results show ALL donors in the same Indian state/district.
- **Results**: Sorted by distance (nearby first, then farther)
- **Map**: each donor is a red dot; overlapping donors are slightly offset so each is clickable. The seeker center is a blue dot with a 10 km reference circle.
- **India-only**: Only shows donors within Indian state boundaries

## Multilingual
- Language selector is in the top navbar across all pages.
- Supported: English (default), తెలుగు, हिन्दी, தமிழ், മലയാളം, ಕನ್ನಡ.
- Choice is saved in localStorage and applied immediately on page switch and dynamic renders.

## Data & Storage
- **Firebase Authentication**: User credentials stored in Firebase Console
- **localStorage keys**: `bloodconnect_data`, `bloodconnect_user`, `bloodconnect_lang`
- **Donor data**: Stored locally in browser (no Firebase data storage)
- **Government ID files**: Stored locally for cross-verification
- All data persists in the browser until cleared

## Troubleshooting
- **Map not loading**: ensure Google Maps API key is valid, billing enabled, and required APIs are active.
- **"ApiNotActivatedMapError"**: enable Maps JavaScript API (and Geocoding API) for your key.
- **Firebase authentication errors**: check Firebase Console for user creation, ensure authentication methods are enabled.
- **"User already exists"**: try signing in instead of signing up, or use a different email.
- **Location not verified on save**: try Detect Location or enter a more specific address with state.
- **No donors showing**: ensure donors are in the same Indian state, have valid coordinates, and are marked as "Available".
- **Language not changing**: hard refresh (Ctrl+F5). The selector should persist across pages.

## Privacy & Notes
- **Authentication**: User credentials are stored securely in Firebase Console
- **Donor data**: Stored locally in browser (no cloud data storage)
- **Government ID files**: Stored locally for cross-verification only
- This is a demo/static app; for production, consider migrating donor data to a secure backend
- Geocoding and maps may send requests to third‑party APIs (Google/OSM)
- Firebase authentication provides secure user management

## License
MIT
