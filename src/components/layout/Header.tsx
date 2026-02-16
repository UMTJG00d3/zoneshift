import { useState, useEffect } from 'react';
import { Globe, Sun, Moon, Monitor, User } from 'lucide-react';
import { useTheme } from '../../providers/ThemeProvider';
import { Button } from '../ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from '../ui/dropdown-menu';
import { Avatar, AvatarFallback } from '../ui/avatar';

const APP_VERSION = '1.6.0';

interface UserInfo {
  name: string;
  username: string;
}

export default function Header() {
  const { theme, setTheme } = useTheme();
  const [user, setUser] = useState<UserInfo | null>(null);

  useEffect(() => {
    fetch('/.auth/me', { credentials: 'include' })
      .then(res => res.json())
      .then(data => {
        if (data?.clientPrincipal) {
          const principal = data.clientPrincipal;
          const claims: { typ: string; val: string }[] = principal.claims || [];
          const nameClaim = claims.find(c => c.typ === 'name');
          const emailClaim = claims.find(c =>
            c.typ === 'preferred_username' ||
            c.typ === 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress'
          );
          setUser({
            name: nameClaim?.val || principal.userDetails || 'User',
            username: emailClaim?.val || principal.userDetails || '',
          });
        }
      })
      .catch(() => { /* not authenticated or unavailable */ });
  }, []);

  const themeIcon = theme === 'dark' ? <Moon className="h-4 w-4" /> :
    theme === 'light' ? <Sun className="h-4 w-4" /> :
    <Monitor className="h-4 w-4" />;

  const initials = user?.name
    ? user.name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
    : 'U';

  return (
    <header className="fixed top-0 left-0 right-0 z-30 glass-heavy border-b border-border/50">
      <div className="flex items-center h-16 px-4 sm:px-6">
        {/* Left: Logo + Title */}
        <a href="#/domains" className="flex items-center gap-2.5 no-underline shrink-0">
          <span className="inline-flex items-center justify-center w-8 h-8 gradient-primary text-white font-bold text-sm rounded-lg shadow-sm">
            <Globe className="h-4 w-4" />
          </span>
          <div>
            <span className="text-foreground font-bold text-lg leading-tight block">ZoneShift</span>
            <span className="text-muted-foreground text-xs leading-tight hidden sm:block">DNS Migration Tool</span>
          </div>
        </a>

        {/* Right: Version + Theme + User */}
        <div className="ml-auto flex items-center gap-2">
          {/* Version badge */}
          <span className="hidden sm:inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-primary/10 text-primary border border-primary/20">
            v{APP_VERSION}
          </span>

          {/* Theme toggle */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8">
                {themeIcon}
                <span className="sr-only">Toggle theme</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setTheme('light')}>
                <Sun className="mr-2 h-4 w-4" />
                Light
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setTheme('dark')}>
                <Moon className="mr-2 h-4 w-4" />
                Dark
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setTheme('system')}>
                <Monitor className="mr-2 h-4 w-4" />
                System
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* User menu */}
          {user && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="h-8 gap-2 px-2">
                  <Avatar className="h-6 w-6">
                    <AvatarFallback className="text-xs bg-primary/10 text-primary">
                      {initials}
                    </AvatarFallback>
                  </Avatar>
                  <span className="hidden md:inline text-sm font-medium text-foreground">
                    {user.name}
                  </span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuLabel className="font-normal">
                  <div className="flex flex-col space-y-1">
                    <p className="text-sm font-medium">{user.name}</p>
                    {user.username && (
                      <p className="text-xs text-muted-foreground truncate">{user.username}</p>
                    )}
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <a href="#/settings" className="no-underline">Settings</a>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>
    </header>
  );
}
