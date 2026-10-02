import React, { useState } from 'react';

const FileUploaderSimple = ({ onUploadSuccess }) => {
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState(null);
  const [error, setError] = useState(null);
  const [skipValidation, setSkipValidation] = useState(false);

  const handleFileChange = (e) => {
    const selectedFile = e.target.files[0];
    setFile(selectedFile);
    setError(null);
    setUploadResult(null);
  };

  const handleUpload = async (e) => {
    e.preventDefault();
    
    if (!file) {
      setError('Please select a file');
      return;
    }

    setUploading(true);
    setError(null);
    setUploadResult(null);

    try {
      const token = localStorage.getItem('token');
      
      console.log('🔍 DEBUG: Token check:', {
        hasToken: !!token,
        tokenLength: token ? token.length : 0,
        tokenStart: token ? token.substring(0, 20) + '...' : 'null'
      });
      
      if (!token) {
        throw new Error('No authentication token found. Please login again.');
      }

      // Check if token is expired before making the request
      try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        const now = Math.floor(Date.now() / 1000);
        const isExpired = payload.exp < now;
        
        console.log('🔍 DEBUG: Token status:', {
          expires: new Date(payload.exp * 1000).toISOString(),
          now: new Date().toISOString(),
          isExpired
        });
        
        if (isExpired) {
          throw new Error('Authentication token has expired. Please login again.');
        }
      } catch (tokenError) {
        if (tokenError.message.includes('expired')) {
          throw tokenError;
        }
        console.warn('🔍 DEBUG: Could not decode token:', tokenError.message);
        // Continue with request even if we can't decode the token
      }

      const formData = new FormData();
      formData.append('file', file);
      
      // Add skipValidation parameter if enabled
      if (skipValidation) {
        formData.append('skipValidation', 'true');
      }

      const response = await fetch('/api/profiles/upload', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`
        },
        body: formData
      });

      console.log('🔍 DEBUG: Response status:', response.status);
      console.log('🔍 DEBUG: Response headers:', Object.fromEntries(response.headers.entries()));

      const result = await response.json();
      console.log('🔍 DEBUG: Response data:', result);

      if (response.status === 401) {
        // Check if token exists and provide more specific error message
        const token = localStorage.getItem('token');
        if (!token) {
          throw new Error('No authentication token found. Please login again.');
        } else {
          // Try to decode token to check if it's expired
          try {
            const payload = JSON.parse(atob(token.split('.')[1]));
            const now = Math.floor(Date.now() / 1000);
            const isExpired = payload.exp < now;
            if (isExpired) {
              throw new Error('Authentication token has expired. Please login again.');
            } else {
              throw new Error('Authentication failed. Token may be invalid. Please login again.');
            }
          } catch (tokenError) {
            throw new Error('Authentication failed. Invalid token format. Please login again.');
          }
        }
      }

      if (!response.ok) {
        // Handle validation errors and other server errors
        if (result.code === 'VALIDATION_FAILED' && result.validation) {
          const validationError = {
            message: result.message,
            validation: result.validation
          };
          setError(validationError);
          return; // Don't throw, just set the error state
        } else {
          // Provide more detailed error information
          const errorMessage = result.message || result.error?.message || 'Unknown server error';
          const errorCode = result.code || result.error?.code || 'UNKNOWN_ERROR';
          throw new Error(`Server error (${response.status}): ${errorMessage} [${errorCode}]`);
        }
      }

      if (result.success) {
        setUploadResult(result);
        setFile(null);
        // Reset file input
        const fileInput = document.getElementById('file-input');
        if (fileInput) fileInput.value = '';
        
        if (onUploadSuccess) {
          onUploadSuccess(result);
        }
      } else {
        throw new Error(result.error?.message || result.message || 'Upload failed');
      }
    } catch (err) {
      console.error('Upload error:', err);
      setError(err.message);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div style={{
      background: 'white',
      borderRadius: '8px',
      boxShadow: '0 2px 4px rgba(0, 0, 0, 0.1)',
      padding: '20px',
      marginBottom: '20px'
    }}>
      <h3>📁 Upload DNA Profiles</h3>
      <p style={{ color: '#666', marginBottom: '20px' }}>
        Upload Excel files (.xlsx, .xls) containing DNA profile data
      </p>

      <form onSubmit={handleUpload}>
        <div style={{ marginBottom: '20px' }}>
          <label style={{ 
            display: 'block', 
            marginBottom: '10px', 
            fontWeight: 'bold' 
          }}>
            Select Excel File:
          </label>
          <input
            id="file-input"
            type="file"
            accept=".xlsx,.xls"
            onChange={handleFileChange}
            disabled={uploading}
            style={{
              width: '100%',
              padding: '10px',
              border: '2px dashed #ddd',
              borderRadius: '4px',
              backgroundColor: uploading ? '#f5f5f5' : 'white',
              cursor: uploading ? 'not-allowed' : 'pointer'
            }}
          />
        </div>

        {/* Skip validation option */}
        <div style={{ marginBottom: '20px' }}>
          <label style={{ 
            display: 'flex', 
            alignItems: 'center',
            fontSize: '14px',
            color: '#666'
          }}>
            <input
              type="checkbox"
              checked={skipValidation}
              onChange={(e) => setSkipValidation(e.target.checked)}
              disabled={uploading}
              style={{ marginRight: '8px' }}
            />
            Пропустить валидацию файла (только для тестирования)
          </label>
        </div>

        {file && (
          <div style={{
            padding: '10px',
            backgroundColor: '#e7f3ff',
            borderRadius: '4px',
            marginBottom: '20px'
          }}>
            <strong>Selected file:</strong> {file.name} ({(file.size / 1024).toFixed(1)} KB)
          </div>
        )}

        <button
          type="submit"
          disabled={!file || uploading}
          style={{
            padding: '12px 24px',
            backgroundColor: uploading ? '#6c757d' : '#007bff',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            fontSize: '16px',
            cursor: (!file || uploading) ? 'not-allowed' : 'pointer',
            opacity: (!file || uploading) ? 0.7 : 1
          }}
        >
          {uploading ? 'Uploading...' : 'Upload File'}
        </button>
      </form>

      {error && (
        <div style={{
          padding: '15px',
          backgroundColor: '#f8d7da',
          color: '#721c24',
          borderRadius: '4px',
          marginTop: '20px'
        }}>
          <strong>Ошибка:</strong> {typeof error === 'string' ? error : error.message}
          
          {/* Display detailed validation errors */}
          {error.validation && (
            <div style={{ marginTop: '15px' }}>
              <strong>Детали валидации:</strong>
              
              {/* Show expertise type */}
              {error.validation.expertiseType && (
                <p style={{ margin: '5px 0', fontSize: '14px' }}>
                  <strong>Тип экспертизы:</strong> {
                    error.validation.expertiseType === 'emergency' ? 'ЧС (чрезвычайные ситуации)' : 'Генетическая экспертиза'
                  }
                </p>
              )}
              
              {/* Show summary */}
              {error.validation.summary && (
                <p style={{ margin: '5px 0', fontSize: '14px' }}>
                  <strong>Обработано строк:</strong> {error.validation.summary.actualDataRows || 0} 
                  {error.validation.summary.skippedEmptyRows > 0 && 
                    ` (пропущено ${error.validation.summary.skippedEmptyRows} пустых строк)`
                  }
                </p>
              )}
              
              {/* Show errors */}
              {error.validation.errors && error.validation.errors.length > 0 && (
                <div style={{ marginTop: '10px' }}>
                  <strong>Найденные ошибки ({error.validation.errors.length}):</strong>
                  <ul style={{ margin: '5px 0', paddingLeft: '20px', maxHeight: '200px', overflowY: 'auto' }}>
                    {error.validation.errors.slice(0, 10).map((err, index) => (
                      <li key={index} style={{ margin: '3px 0', fontSize: '13px' }}>
                        {err.message}
                        {err.details?.cellAddress && (
                          <span style={{ color: '#666', fontWeight: 'normal' }}>
                            {' '}(ячейка {err.details.cellAddress})
                          </span>
                        )}
                      </li>
                    ))}
                    {error.validation.errors.length > 10 && (
                      <li style={{ margin: '3px 0', fontSize: '13px', fontStyle: 'italic' }}>
                        ... и еще {error.validation.errors.length - 10} ошибок
                      </li>
                    )}
                  </ul>
                </div>
              )}
              
              {/* Show warnings */}
              {error.validation.warnings && error.validation.warnings.length > 0 && (
                <div style={{ marginTop: '10px' }}>
                  <strong>Предупреждения ({error.validation.warnings.length}):</strong>
                  <ul style={{ margin: '5px 0', paddingLeft: '20px', maxHeight: '100px', overflowY: 'auto' }}>
                    {error.validation.warnings.slice(0, 5).map((warn, index) => (
                      <li key={index} style={{ margin: '3px 0', fontSize: '13px', color: '#856404' }}>
                        {warn.message}
                      </li>
                    ))}
                    {error.validation.warnings.length > 5 && (
                      <li style={{ margin: '3px 0', fontSize: '13px', fontStyle: 'italic', color: '#856404' }}>
                        ... и еще {error.validation.warnings.length - 5} предупреждений
                      </li>
                    )}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {uploadResult && (
        <div style={{
          padding: '15px',
          backgroundColor: '#d4edda',
          color: '#155724',
          borderRadius: '4px',
          marginTop: '20px'
        }}>
          <strong>✅ Upload Successful!</strong>
          <div style={{ marginTop: '10px', fontSize: '14px' }}>
            <p><strong>Processed:</strong> {uploadResult.parsing?.totalParsed || 0} profiles</p>
            <p><strong>Valid:</strong> {uploadResult.processing?.created || 0} profiles</p>
            <p><strong>Invalid:</strong> {uploadResult.processing?.errors || 0} profiles</p>
            {(uploadResult.processing?.duplicates || 0) > 0 && (
              <p><strong>Duplicates:</strong> {uploadResult.processing.duplicates} profiles</p>
            )}
          </div>
        </div>
      )}

      <div style={{
        marginTop: '20px',
        padding: '15px',
        backgroundColor: '#f8f9fa',
        borderRadius: '4px',
        fontSize: '14px'
      }}>
        <strong>Supported formats:</strong>
        <ul style={{ margin: '10px 0', paddingLeft: '20px' }}>
          <li>Excel files (.xlsx, .xls)</li>
          <li>Maximum file size: 10MB</li>
          <li>Must contain STR loci data</li>
          <li>Supported loci: D3S1358, vWA, D16S539, CSF1PO, TPOX, D8S1179, D21S11, D18S51, DYS391, D2S441, D19S433, TH01, FGA, D22S1045, D5S818, D13S317, D7S820, SE33, D10S1248, D1S1656, D12S391, D2S1338, AMEL</li>
        </ul>
      </div>
    </div>
  );
};

export default FileUploaderSimple;