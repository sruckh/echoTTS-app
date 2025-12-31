import { useCallback } from 'react';

// Allowed audio file types
const ALLOWED_TYPES = [
  'audio/m4a',
  'audio/mp3',
  'audio/mpeg',
  'audio/wav',
  'audio/ogg',
  'audio/opus',
  'audio/x-m4a',
];

const ALLOWED_EXTENSIONS = ['.m4a', '.mp3', '.wav', '.ogg', '.opus'];

// Max file size: 100MB
const MAX_FILE_SIZE_BYTES = 100 * 1024 * 1024;

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

export interface UseFileUploadReturn {
  validateFile: (file: File) => ValidationResult;
  uploadToS3: (
    file: File,
    presignedUrl: string,
    onProgress?: (progress: number) => void
  ) => Promise<void>;
  getDuration: (file: File) => Promise<number>;
}

export function useFileUpload(): UseFileUploadReturn {
  /**
   * Validate file type and size
   */
  const validateFile = useCallback((file: File): ValidationResult => {
    // Check file type
    const fileExtension = '.' + file.name.split('.').pop()?.toLowerCase();
    const isValidType = ALLOWED_TYPES.includes(file.type.toLowerCase()) ||
                       ALLOWED_EXTENSIONS.includes(fileExtension);

    if (!isValidType) {
      return {
        valid: false,
        error: 'Please upload an audio file (.m4a, .mp3, .wav, .ogg, .opus)',
      };
    }

    // Check file size
    if (file.size > MAX_FILE_SIZE_BYTES) {
      return {
        valid: false,
        error: 'File exceeds maximum size of 100MB',
      };
    }

    return { valid: true };
  }, []);

  /**
   * Get audio duration from file using HTML5 Audio API
   */
  const getDuration = useCallback((file: File): Promise<number> => {
    return new Promise((resolve, reject) => {
      const audio = new Audio();

      audio.onloadedmetadata = () => {
        URL.revokeObjectURL(audio.src);

        if (audio.duration === Infinity || isNaN(audio.duration)) {
          // Some audio formats might return Infinity initially
          resolve(0);
        } else {
          resolve(audio.duration);
        }
      };

      audio.onerror = () => {
        URL.revokeObjectURL(audio.src);
        reject(new Error('Failed to load audio metadata'));
      };

      audio.src = URL.createObjectURL(file);
    });
  }, []);

  /**
   * Upload file to S3 via presigned URL
   */
  const uploadToS3 = useCallback(
    async (
      file: File,
      presignedUrl: string,
      onProgress?: (progress: number) => void
    ): Promise<void> => {
      return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();

        // Track upload progress
        xhr.upload.addEventListener('progress', (e) => {
          if (e.lengthComputable && onProgress) {
            const progress = Math.round((e.loaded / e.total) * 100);
            onProgress(progress);
          }
        });

        xhr.addEventListener('load', () => {
          if (xhr.status === 200) {
            resolve();
          } else {
            reject(new Error(`Upload failed with status ${xhr.status}`));
          }
        });

        xhr.addEventListener('error', () => {
          reject(new Error('Upload failed. Please check your connection.'));
        });

        xhr.addEventListener('abort', () => {
          reject(new Error('Upload was cancelled.'));
        });

        xhr.open('PUT', presignedUrl);
        xhr.setRequestHeader('Content-Type', file.type);
        xhr.send(file);
      });
    },
    []
  );

  return {
    validateFile,
    uploadToS3,
    getDuration,
  };
}
