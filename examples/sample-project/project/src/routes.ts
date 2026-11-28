// 합성 샘플: 할 일 목록 API의 라우트 정의.
export interface Todo { id: number; title: string; done: boolean }

const todos: Todo[] = [];

export function listTodos(): Todo[] {
  return todos;
}

export function addTodo(title: string): Todo {
  const todo = { id: todos.length + 1, title, done: false };
  todos.push(todo);
  return todo;
}
