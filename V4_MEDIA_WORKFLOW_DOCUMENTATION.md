# V4 Current Media Workflow Documentation

*Created: Phase 0 of V3→V4 integration*
*Purpose: Document existing V4 media workflow before adding V3 features*

## Architecture Overview

V4 uses a **dual-layer storage system** for optimal performance:
- **IndexedDB**: Structured data (metadata, projects, sounds)
- **OPFS (Origin Private File System)**: Large media files

## Current Media Store Structure (`media-store.ts`)

### State
```typescript
interface MediaStore {
  mediaFiles: MediaFile[];
  isLoading: boolean;
}
```

### Key Operations

#### 1. Add Media File
**Flow**: `addMediaFile(projectId, file)`
1. Generate UUID for new media item
2. Add to local state immediately (UI responsiveness)
3. Save to persistent storage via `storageService.saveMediaFile()`
4. If storage fails, remove from local state

#### 2. Remove Media File
**Flow**: `removeMediaFile(projectId, id)`
1. Clear video cache for the item
2. Cleanup object URLs (prevent memory leaks)
3. Remove from local state
4. Cascade removal from timeline (remove all elements using this media)
5. Remove from persistent storage

#### 3. Load Project Media
**Flow**: `loadProjectMedia(projectId)`
1. Load metadata from IndexedDB
2. Load files from OPFS
3. Regenerate video thumbnails
4. Update local state

## Storage Service Architecture (`storage-service.ts`)

### Project-Specific Storage
- **Media Metadata**: `video-editor-media-{projectId}` (IndexedDB)
- **Media Files**: `media-files-{projectId}` (OPFS)
- **Timeline**: `video-editor-timelines-{projectId}` (IndexedDB)

### Media File Storage Process
1. **File Storage**: Save actual file to OPFS with media ID
2. **Metadata Storage**: Save file metadata to IndexedDB:
   ```typescript
   interface MediaFileData {
     id: string;
     name: string;
     type: MediaType;
     size: number;
     lastModified: number;
     width?: number;
     height?: number;
     duration?: number;
     ephemeral?: boolean;
   }
   ```

### Media File Loading Process
1. Load file and metadata in parallel
2. Create object URL for file access
3. Handle special cases (SVG detection for images)
4. Return combined MediaFile object

## Helper Functions

### Media Processing
- `getFileType()`: Determine media type from MIME
- `getImageDimensions()`: Extract image dimensions
- `generateVideoThumbnail()`: Create video thumbnails at 1s or 10% duration
- `getMediaDuration()`: Extract audio/video duration
- `getMediaAspectRatio()`: Calculate aspect ratio with 16:9 fallback

### Memory Management
- URL cleanup on file removal
- Video cache clearing
- Object URL revocation

## Integration Points for V3

### Current Limitations (to be addressed by V3 integration):
1. **No AI Analysis**: Files stored but no intelligence extraction
2. **No Persistent Metadata**: No external service status tracking
3. **No Programmatic Access**: Only UI-driven operations
4. **No Chat Interface**: No conversational editing commands

### Extension Points:
1. **MediaFile Interface**: Can be extended with Twelvelabs fields
2. **Storage Service**: Can add Supabase persistence layer
3. **Media Store**: Can add background processing and status tracking
4. **Helper Functions**: Can add AI analysis triggers

## Current File Structure
```
apps/web/src/
├── stores/media-store.ts          # Main media state management
├── lib/storage/
│   ├── storage-service.ts         # Multi-layer storage orchestration
│   ├── indexeddb-adapter.ts       # IndexedDB interface
│   ├── opfs-adapter.ts           # OPFS interface
│   └── types.ts                  # Storage type definitions
└── types/media.ts                # Media file type definitions
```

This documentation will help ensure V3 integration preserves V4's efficient storage architecture while adding AI-powered features.