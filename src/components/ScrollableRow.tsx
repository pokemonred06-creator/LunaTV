interface ScrollableRowProps {
  children: React.ReactNode;
}

export default function ScrollableRow({ children }: ScrollableRowProps) {
  return (
    <div className='flex space-x-6 overflow-x-auto py-1 sm:py-2 pb-12 sm:pb-14 px-4 sm:px-6'>
      {children}
    </div>
  );
}
