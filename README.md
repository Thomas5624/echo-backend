# Echo YTMusic Proxy Backend

Backend proxy server for Echo app to access YouTube Music API without CORS issues.

## Setup

1. Install dependencies:
```bash
npm install
```

2. Start the server:
```bash
npm start
```

For development with auto-reload:
```bash
npm run dev
```

## API Endpoints

### Health Check
```
GET /health
```

### Search
```
POST /api/search
Body: { "query": "song name", "type": "song" }
```

### Get Song Details
```
GET /api/song/:videoId
```

### Get Stream URL
```
GET /api/stream/:videoId
```

### Get Artist
```
GET /api/artist/:artistId
```

### Get Album
```
GET /api/album/:albumId
```

## Deploy to Vercel

1. Install Vercel CLI:
```bash
npm i -g vercel
```

2. Deploy:
```bash
vercel
```

## Environment Variables

- `PORT`: Server port (default: 3000)
- `NODE_ENV`: Environment (development/production)
