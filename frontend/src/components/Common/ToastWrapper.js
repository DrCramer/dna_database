import React from 'react';
import ToastContainer from './ToastContainer';

/**
 * Обертка для ToastContainer
 * Передает уведомление из props
 */
const ToastWrapper = ({ notification }) => {
  return <ToastContainer notification={notification} />;
};

export default ToastWrapper;
