import React, { useEffect } from 'react';

export const SimpleRouter = ({ children, currentPath }) => {
  const routes = React.Children.toArray(children);

  const currentRoute = routes.find((route) => {
    const path = route.props.path;
    if (path === currentPath) return true;
    if (path === '*' && !routes.some((candidate) => candidate.props.path === currentPath)) return true;
    return false;
  });

  return currentRoute ? (
    <div key={currentPath}>
      {currentRoute.props.element}
    </div>
  ) : null;
};

export const Route = () => null;

export const Navigate = ({ to, replace }) => {
  useEffect(() => {
    if (replace) {
      window.history.replaceState(null, '', to);
    } else {
      window.history.pushState(null, '', to);
    }
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, [to, replace]);

  return null;
};
