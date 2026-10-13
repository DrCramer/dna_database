import React from 'react';

const StatusMessages = ({ messages, type = 'info' }) => {
  if (!messages || messages.length === 0) {
    return null;
  }

  const getTypeColor = (type) => {
    switch (type) {
      case 'error': return '#dc3545';
      case 'warning': return '#ffc107';
      case 'success': return '#28a745';
      default: return '#007bff';
    }
  };

  return (
    <div style={{
      padding: '15px',
      margin: '10px 0',
      backgroundColor: '#f8f9fa',
      border: `1px solid ${getTypeColor(type)}`,
      borderRadius: '4px',
      color: getTypeColor(type)
    }}>
      {Array.isArray(messages) ? (
        <ul style={{ margin: 0, paddingLeft: '20px' }}>
          {messages.map((message, index) => (
            <li key={index}>{message}</li>
          ))}
        </ul>
      ) : (
        <p style={{ margin: 0 }}>{messages}</p>
      )}
    </div>
  );
};

export default StatusMessages;