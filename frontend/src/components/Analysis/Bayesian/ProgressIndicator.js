import React from 'react';

const ProgressIndicator = ({ progress, message }) => {
  return (
    <div style={{ padding: '20px', textAlign: 'center' }}>
      <div style={{ 
        width: '100%', 
        backgroundColor: '#f0f0f0', 
        borderRadius: '4px',
        marginBottom: '10px'
      }}>
        <div style={{
          width: `${progress}%`,
          height: '20px',
          backgroundColor: '#007bff',
          borderRadius: '4px',
          transition: 'width 0.3s ease'
        }}></div>
      </div>
      <p>{message}</p>
    </div>
  );
};

export default ProgressIndicator;