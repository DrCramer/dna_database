import React, { useState, useEffect } from 'react';
import ToastNotification from './ToastNotification';

/**
 * Контейнер для Toast уведомлений
 * Показывает уведомления переданные через props
 * @param {Object} notification - Уведомление для отображения
 */
const ToastContainer = ({ notification }) => {
  const [currentNotification, setCurrentNotification] = useState(null);

  useEffect(() => {
    if (notification) {
      setCurrentNotification(notification);
    }
  }, [notification]);

  const handleClose = () => {
    setCurrentNotification(null);
  };

  return (
    <ToastNotification 
      notification={currentNotification} 
      onClose={handleClose} 
    />
  );
};

export default ToastContainer;
