
import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Upload, FileText, Check, AlertCircle, X } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

interface UploadedFile {
  id: string;
  name: string;
  size: number;
  type: string;
  uploadedAt: Date;
  status: 'uploading' | 'processing' | 'completed' | 'error';
  progress?: number;
}

const ResumeUpload = () => {
  const { user } = useAuth();
  const [isDragOver, setIsDragOver] = useState(false);
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [isUploading, setIsUploading] = useState(false);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    
    const files = Array.from(e.dataTransfer.files);
    handleFiles(files);
  }, []);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const files = Array.from(e.target.files);
      handleFiles(files);
    }
  };

  const uploadToSupabase = async (file: File, fileId: string) => {
    if (!user) {
      throw new Error('User not authenticated');
    }

    console.log('Starting upload for file:', file.name, 'User ID:', user.id);

    // Create file path with user folder structure
    const fileExt = file.name.split('.').pop();
    const fileName = `${user.id}/${fileId}.${fileExt}`;

    // Upload file to Supabase Storage
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('resumes')
      .upload(fileName, file, {
        cacheControl: '3600',
        upsert: false
      });

    if (uploadError) {
      console.error('Upload error:', uploadError);
      throw uploadError;
    }

    console.log('File uploaded successfully:', uploadData);

    // Insert record into resumes table
    const { data: resumeData, error: resumeError } = await supabase
      .from('resumes')
      .insert([
        {
          id: fileId,
          user_id: user.id,
          file_name: file.name,
          file_size: file.size,
          file_type: file.type,
          supabase_storage_path: uploadData.path,
          parsing_status: 'pending'
        }
      ])
      .select()
      .single();

    if (resumeError) {
      console.error('Database error:', resumeError);
      // Clean up uploaded file if database insert fails
      await supabase.storage.from('resumes').remove([fileName]);
      throw resumeError;
    }

    console.log('Resume record created:', resumeData);
    return resumeData;
  };

  const handleFiles = async (files: File[]) => {
    if (!user) {
      toast({
        title: "Authentication required",
        description: "Please log in to upload resumes.",
        variant: "destructive"
      });
      return;
    }

    // Expanded list of supported file types
    const allowedTypes = [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
      'application/msword', // .doc
      'text/plain', // .txt
      'application/rtf', // .rtf
      'text/rtf', // .rtf (alternative MIME type)
      'application/vnd.oasis.opendocument.text', // .odt
    ];

    const validFiles = files.filter(file => {
      const isValidType = allowedTypes.includes(file.type) || 
                         file.name.toLowerCase().endsWith('.txt') ||
                         file.name.toLowerCase().endsWith('.rtf') ||
                         file.name.toLowerCase().endsWith('.odt');
      
      if (!isValidType) {
        console.log('Invalid file type:', file.type, 'for file:', file.name);
      }
      
      return isValidType;
    });

    if (validFiles.length === 0) {
      toast({
        title: "Invalid file type",
        description: "Please upload PDF, Word documents (.doc, .docx), text files (.txt), RTF files (.rtf), or ODT files.",
        variant: "destructive"
      });
      return;
    }

    // Check file sizes (max 25MB to accommodate larger documents)
    const oversizedFiles = validFiles.filter(file => file.size > 25 * 1024 * 1024);
    if (oversizedFiles.length > 0) {
      toast({
        title: "File too large",
        description: "Please upload files smaller than 25MB.",
        variant: "destructive"
      });
      return;
    }

    setIsUploading(true);

    for (const file of validFiles) {
      const fileId = crypto.randomUUID();
      const uploadFile: UploadedFile = {
        id: fileId,
        name: file.name,
        size: file.size,
        type: file.type,
        uploadedAt: new Date(),
        status: 'uploading',
        progress: 0
      };

      setUploadedFiles(prev => [...prev, uploadFile]);

      try {
        console.log('Processing file:', file.name);
        
        // Update progress to show uploading
        setUploadedFiles(prev => 
          prev.map(f => 
            f.id === fileId 
              ? { ...f, progress: 30 }
              : f
          )
        );

        // Upload to Supabase
        await uploadToSupabase(file, fileId);

        // Update progress
        setUploadedFiles(prev => 
          prev.map(f => 
            f.id === fileId 
              ? { ...f, progress: 60 }
              : f
          )
        );

        // Update status to processing (this would trigger LLM parsing in a real app)
        setUploadedFiles(prev => 
          prev.map(f => 
            f.id === fileId 
              ? { ...f, status: 'processing', progress: 80 }
              : f
          )
        );

        // Simulate processing time (in real app, this would be handled by background job with LLM)
        setTimeout(() => {
          setUploadedFiles(prev => 
            prev.map(f => 
              f.id === fileId 
                ? { ...f, status: 'completed', progress: 100 }
                : f
            )
          );
          
          toast({
            title: "Resume uploaded",
            description: `${file.name} has been uploaded successfully and is ready for AI processing.`,
          });
        }, 2000);

      } catch (error) {
        console.error('Upload failed:', error);
        setUploadedFiles(prev => 
          prev.map(f => 
            f.id === fileId 
              ? { ...f, status: 'error' }
              : f
          )
        );
        
        toast({
          title: "Upload failed",
          description: `Failed to upload ${file.name}. Please try again.`,
          variant: "destructive"
        });
      }
    }

    setIsUploading(false);
  };

  const removeFile = (fileId: string) => {
    setUploadedFiles(prev => prev.filter(f => f.id !== fileId));
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const getFileTypeIcon = (fileName: string, mimeType: string) => {
    const extension = fileName.split('.').pop()?.toLowerCase();
    
    if (mimeType === 'application/pdf' || extension === 'pdf') {
      return <FileText className="w-8 h-8 text-red-600" />;
    } else if (
      mimeType.includes('word') || 
      extension === 'doc' || 
      extension === 'docx'
    ) {
      return <FileText className="w-8 h-8 text-blue-600" />;
    } else if (
      mimeType === 'text/plain' || 
      extension === 'txt'
    ) {
      return <FileText className="w-8 h-8 text-gray-600" />;
    } else {
      return <FileText className="w-8 h-8 text-green-600" />;
    }
  };

  if (!user) {
    return (
      <div className="space-y-6">
        <Card className="border-0 shadow-lg bg-white/60 backdrop-blur-sm">
          <CardContent className="p-8 text-center">
            <p className="text-gray-600">Please log in to upload resumes.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card className="border-0 shadow-lg bg-white/60 backdrop-blur-sm">
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Upload className="w-5 h-5" />
            <span>Upload Resumes</span>
          </CardTitle>
          <CardDescription>
            Upload documents to build your talent pool. Supports PDF, Word (.doc, .docx), text (.txt), RTF, and ODT files up to 25MB each.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div
            className={`border-2 border-dashed rounded-lg p-8 text-center transition-all duration-300 ${
              isDragOver 
                ? 'border-blue-500 bg-blue-50/50' 
                : 'border-gray-300 hover:border-gray-400 hover:bg-gray-50/50'
            }`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <Upload className="w-12 h-12 text-gray-400 mx-auto mb-4" />
            <h3 className="text-lg font-medium mb-2">Drop files here or click to browse</h3>
            <p className="text-gray-600 mb-4">
              Supports PDF, Word, Text, RTF, and ODT documents up to 25MB each
            </p>
            <input
              type="file"
              multiple
              accept=".pdf,.doc,.docx,.txt,.rtf,.odt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/msword,text/plain,application/rtf,text/rtf,application/vnd.oasis.opendocument.text"
              onChange={handleFileSelect}
              className="hidden"
              id="file-upload"
              disabled={isUploading}
            />
            <Button 
              asChild 
              className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700"
              disabled={isUploading}
            >
              <label htmlFor="file-upload" className="cursor-pointer">
                {isUploading ? 'Uploading...' : 'Choose Files'}
              </label>
            </Button>
          </div>
        </CardContent>
      </Card>

      {uploadedFiles.length > 0 && (
        <Card className="border-0 shadow-lg bg-white/60 backdrop-blur-sm">
          <CardHeader>
            <CardTitle>Upload Progress</CardTitle>
            <CardDescription>
              Track the upload and processing status of your documents.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {uploadedFiles.map((file) => (
                <div key={file.id} className="flex items-center justify-between p-3 bg-white/50 rounded-lg border">
                  <div className="flex items-center space-x-3 flex-1">
                    {getFileTypeIcon(file.name, file.type)}
                    <div className="flex-1">
                      <p className="font-medium">{file.name}</p>
                      <p className="text-sm text-gray-600">{formatFileSize(file.size)}</p>
                      {file.status === 'uploading' && file.progress !== undefined && (
                        <div className="w-full bg-gray-200 rounded-full h-2 mt-1">
                          <div 
                            className="bg-blue-600 h-2 rounded-full transition-all duration-300" 
                            style={{ width: `${file.progress}%` }}
                          />
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center space-x-2">
                    {file.status === 'uploading' && (
                      <>
                        <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
                        <span className="text-sm text-blue-600">Uploading...</span>
                      </>
                    )}
                    {file.status === 'processing' && (
                      <>
                        <div className="w-4 h-4 border-2 border-yellow-600 border-t-transparent rounded-full animate-spin" />
                        <span className="text-sm text-yellow-600">Processing...</span>
                      </>
                    )}
                    {file.status === 'completed' && (
                      <>
                        <Check className="w-4 h-4 text-green-600" />
                        <span className="text-sm text-green-600">Completed</span>
                      </>
                    )}
                    {file.status === 'error' && (
                      <>
                        <AlertCircle className="w-4 h-4 text-red-600" />
                        <span className="text-sm text-red-600">Error</span>
                      </>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => removeFile(file.id)}
                      className="h-8 w-8 p-0"
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default ResumeUpload;
